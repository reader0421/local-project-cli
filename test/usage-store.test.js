import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../desktop/src/main/usage-store.js';

const projects = [
  { id: 'p1', repositories: [{ id: 'r1' }, { id: 'r2' }] },
  { id: 'p2', repositories: [{ id: 'r3' }] },
];
const registry = '/test/registry.json';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-usage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = new Date(2026, 8, 17, 12).getTime();
  const options = { now: () => time };
  return {
    directory, store: new UsageStore(directory, options),
    setTime: (value) => { time = value; },
    restart: () => new UsageStore(directory, options),
    data: async () => JSON.parse(await readFile(join(directory, (await readdir(directory))[0]), 'utf8')),
  };
}

test('并发访问和项目 webhook 累加不丢失，并按本地自然日分组', async (t) => {
  const f = await fixture(t);
  await Promise.all([
    ...Array.from({ length: 25 }, () => f.store.record(registry, 'p1', 'r1')),
    ...Array.from({ length: 10 }, () => f.store.record(registry, 'p1')),
  ]);
  const data = await f.data();
  assert.equal(data.days['2026-09-17'].projects.p1, 35);
  assert.equal(data.days['2026-09-17'].repositories.r1, 25);
  assert.equal(data.recent.length, 25);
});

test('只保留今天和前六天，启动排序固定，重启才读取新频次', async (t) => {
  const f = await fixture(t);
  f.setTime(new Date(2026, 8, 10, 23, 59).getTime());
  await f.store.record(registry, 'p1', 'r1');
  f.setTime(new Date(2026, 8, 11, 0, 0).getTime());
  await f.store.record(registry, 'p2', 'r3');
  f.setTime(new Date(2026, 8, 17, 12).getTime());
  assert.deepEqual(await f.store.projectOrder(registry, projects), ['p2', 'p1']);
  assert.deepEqual(Object.keys((await f.data()).days), ['2026-09-11']);
  await f.store.record(registry, 'p1', 'r1');
  await f.store.record(registry, 'p1', 'r2');
  assert.deepEqual(await f.store.projectOrder(registry, projects), ['p2', 'p1']);
  assert.deepEqual(await f.restart().projectOrder(registry, projects), ['p1', 'p2']);
  const added = [...projects, { id: 'p3', repositories: [] }];
  assert.deepEqual(await f.store.projectOrder(registry, added), ['p2', 'p1', 'p3']);
});

test('滚动 24 小时精确排除边界，同次数优先最近使用', async (t) => {
  const f = await fixture(t);
  const now = new Date(2026, 8, 17, 12).getTime();
  f.setTime(now - 86400000);
  await f.store.record(registry, 'p1', 'r1');
  await f.store.record(registry, 'p1', 'r1');
  f.setTime(now - 86400000 + 1);
  await f.store.record(registry, 'p2', 'r3');
  f.setTime(now);
  await f.store.record(registry, 'p1', 'r2');
  const ranked = await f.store.trayRepositories(registry, projects);
  assert.deepEqual(ranked.map(({ repository }) => repository.id), ['r2', 'r3', 'r1']);
  assert.equal((await f.data()).recent.length, 2);
});

test('快照跨重启和长期闲置保留，删除的仓库过滤，最多十项', async (t) => {
  const f = await fixture(t);
  const many = [{ id: 'p1', repositories: Array.from({ length: 12 }, (_, index) => ({ id: `r${index}` })) }];
  await f.store.record(registry, 'p1', 'r11');
  await f.store.record(registry, 'p1', 'r10');
  await f.store.record(registry, 'p1', 'r10');
  const ids = (entries) => entries.map(({ repository }) => repository.id);
  const first = ids(await f.store.trayRepositories(registry, many));
  assert.equal(first.length, 10);
  assert.deepEqual(first.slice(0, 2), ['r10', 'r11']);
  f.setTime(new Date(2026, 9, 17, 12).getTime());
  const restarted = f.restart();
  assert.deepEqual(ids(await restarted.trayRepositories(registry, many)), first);
  assert.deepEqual((await f.data()).days, {});
  assert.deepEqual((await f.data()).recent, []);
  many[0].repositories = many[0].repositories.filter((repository) => repository.id !== 'r10');
  const afterDeletion = ids(await restarted.trayRepositories(registry, many));
  assert.equal(afterDeletion.length, 10);
  assert.equal(afterDeletion[0], 'r11');
  assert.ok(!afterDeletion.includes('r10'));
  assert.deepEqual((await f.data()).traySnapshot, afterDeletion);
});

test('不同注册表统计和快照互相隔离，无数据时保持原顺序', async (t) => {
  const f = await fixture(t);
  await f.store.record(registry, 'p2', 'r3');
  assert.deepEqual(await f.store.projectOrder('/other/registry.json', projects), ['p1', 'p2']);
  assert.equal((await f.store.trayRepositories('/other/registry.json', projects))[0].repository.id, 'r1');
  assert.deepEqual(await f.store.projectOrder(registry, projects), ['p2', 'p1']);
});
