import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;

function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function prune(data, now) {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - 6);
  const firstDay = dayKey(oldest);
  const today = dayKey(now);
  for (const key of Object.keys(data.days)) {
    if (key < firstDay || key > today) delete data.days[key];
  }
  // 单独保留精确时间，不能用两个自然日的计数代替滚动 24 小时。
  data.recent = data.recent.filter((event) => event.at > now - DAY && event.at <= now);
}

export class UsageStore {
  constructor(directory, { now = Date.now } = {}) {
    this.directory = directory;
    this.now = now;
    this.queue = Promise.resolve();
    this.startupOrders = new Map();
  }

  transact(registryPath, action) {
    const operation = this.queue.then(async () => {
      const key = createHash('sha256').update(registryPath).digest('hex');
      const path = join(this.directory, `${key}.json`);
      let data;
      try {
        data = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        data = { version: 1, days: {}, recent: [], traySnapshot: [] };
      }
      const now = this.now();
      prune(data, now);
      const result = action(data, now);
      await mkdir(this.directory, { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      await rename(temporary, path);
      return result;
    });
    // 串行更新，连续点击不会覆盖计数；单次写入失败不阻塞后续操作。
    this.queue = operation.catch(() => {});
    return operation;
  }

  record(registryPath, projectId, repositoryId = null) {
    return this.transact(registryPath, (data, now) => {
      const group = data.days[dayKey(now)] ||= { projects: {}, repositories: {} };
      group.projects[projectId] = (group.projects[projectId] || 0) + 1;
      if (repositoryId) {
        group.repositories[repositoryId] = (group.repositories[repositoryId] || 0) + 1;
        data.recent.push({ repositoryId, at: now });
      }
    });
  }

  async projectOrder(registryPath, projects) {
    if (!this.startupOrders.has(registryPath)) {
      // 缓存 Promise，首次并发读取也只计算一次，窗口重建不重新排序。
      const pending = this.transact(registryPath, (data) => {
        const totals = new Map();
        for (const day of Object.values(data.days)) {
          for (const [id, count] of Object.entries(day.projects)) totals.set(id, (totals.get(id) || 0) + count);
        }
        return [...projects].sort((a, b) => (totals.get(b.id) || 0) - (totals.get(a.id) || 0)).map((project) => project.id);
      });
      this.startupOrders.set(registryPath, pending);
      pending.catch(() => this.startupOrders.delete(registryPath));
    }
    const order = await this.startupOrders.get(registryPath);
    for (const project of projects) if (!order.includes(project.id)) order.push(project.id);
    return [...order];
  }

  trayRepositories(registryPath, projects) {
    return this.transact(registryPath, (data) => {
      const entries = projects.flatMap((project) => project.repositories.map((repository) => ({ project, repository })));
      const valid = new Map(entries.map((entry) => [entry.repository.id, entry]));
      const totals = new Map();
      for (const event of data.recent) {
        if (!valid.has(event.repositoryId)) continue;
        const score = totals.get(event.repositoryId) || { count: 0, last: 0 };
        score.count += 1;
        score.last = Math.max(score.last, event.at);
        totals.set(event.repositoryId, score);
      }
      const ranked = [...totals.keys()].sort((a, b) => totals.get(b).count - totals.get(a).count || totals.get(b).last - totals.get(a).last);
      // 不足十项时用上次快照补齐，首次使用再按注册表顺序补齐。
      const ids = [...new Set([...ranked, ...data.traySnapshot, ...valid.keys()])].filter((id) => valid.has(id)).slice(0, 10);
      data.traySnapshot = ids;
      return ids.map((id) => valid.get(id));
    });
  }

  cleanup(registryPath) {
    return this.transact(registryPath, () => {});
  }

  flush() {
    return this.queue;
  }
}
