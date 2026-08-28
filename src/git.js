import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

async function git(path, args, options = {}) {
  const result = await execFileAsync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return result.stdout.trimEnd();
}

async function gitPathExists(path, name) {
  try {
    const location = await git(path, ['rev-parse', '--git-path', name]);
    await access(isAbsolute(location) ? location : resolve(path, location));
    return true;
  } catch {
    return false;
  }
}

async function readCommits(path, revision, limit = 5) {
  try {
    const raw = await git(path, ['log', `--max-count=${limit}`, '--format=%h%x1f%aI%x1f%an%x1f%s', revision]);
    return raw ? raw.split('\n').map((line) => {
      const [hash, authoredAt, author, subject] = line.split('\x1f');
      return { hash, authoredAt, author, subject };
    }).filter((commit) => commit.hash) : [];
  } catch {
    return [];
  }
}

async function readCommit(path, revision) {
  return (await readCommits(path, revision, 1))[0] || null;
}

function parseBranch(lines) {
  const value = (key) => lines.find((line) => line.startsWith(`# ${key} `))?.slice(key.length + 3);
  const counts = value('branch.ab')?.match(/^\+(\d+) -(\d+)$/);
  return {
    branch: value('branch.head') || null,
    oid: value('branch.oid') || null,
    upstream: value('branch.upstream') || null,
    ahead: counts ? Number(counts[1]) : 0,
    behind: counts ? Number(counts[2]) : 0,
  };
}

function parseChanges(records) {
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith('? ')) {
      entries.push({ code: '??', path: record.slice(2) });
      continue;
    }
    const ordinary = record.match(/^1 (\S+)(?: \S+){6} (.*)$/);
    if (ordinary) {
      entries.push({ code: ordinary[1], path: ordinary[2] });
      continue;
    }
    const renamed = record.match(/^2 (\S+)(?: \S+){7} (.*)$/);
    if (renamed) {
      entries.push({ code: renamed[1], path: renamed[2], originalPath: records[index + 1] || null });
      index += 1;
      continue;
    }
    const unmerged = record.match(/^u (\S+)(?: \S+){8} (.*)$/);
    if (unmerged) entries.push({ code: unmerged[1], path: unmerged[2] });
  }
  return entries;
}

export async function getGitStatus(path) {
  try {
    const inside = await git(path, ['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') return { kind: 'non_git', path };
  } catch {
    return { kind: 'non_git', path };
  }

  const porcelain = await git(path, ['status', '--porcelain=v2', '--branch', '-z']);
  const records = porcelain ? porcelain.split('\0').filter(Boolean) : [];
  const branch = parseBranch(records);
  const changes = parseChanges(records);
  const recentCommits = await readCommits(path, 'HEAD', 5);
  const lastCommit = recentCommits[0] || null;
  const upstreamCommit = branch.upstream ? await readCommit(path, '@{upstream}') : null;
  let unpushedCommits = [];
  if (branch.upstream && branch.ahead > 0) {
    const raw = await git(path, ['log', '--format=%h%x1f%s', '@{upstream}..HEAD']);
    unpushedCommits = raw ? raw.split('\n').map((line) => {
      const [hash, subject] = line.split('\x1f');
      return { hash, subject };
    }) : [];
  }
  const remoteCommits = branch.upstream && branch.behind > 0
    ? await readCommits(path, 'HEAD..@{upstream}', branch.behind)
    : [];
  const operation = (await gitPathExists(path, 'rebase-merge')) || (await gitPathExists(path, 'rebase-apply'))
    ? 'rebase'
    : (await gitPathExists(path, 'MERGE_HEAD'))
      ? 'merge'
      : (await gitPathExists(path, 'CHERRY_PICK_HEAD'))
        ? 'cherry-pick'
        : null;

  return {
    kind: 'git',
    path,
    ...branch,
    detached: branch.branch === '(detached)',
    changes,
    dirty: changes.length > 0,
    lastCommit,
    recentCommits,
    upstreamCommit,
    unpushedCommits,
    remoteCommits,
    operation,
  };
}

export async function fetchRepository(path) {
  await git(path, ['fetch', '--prune']);
}

export function getPushEligibility(status) {
  if (status.kind !== 'git') return { eligible: false, reason: '未初始化 Git' };
  if (status.detached) return { eligible: false, reason: 'detached HEAD' };
  if (status.operation) return { eligible: false, reason: `正在进行 ${status.operation}` };
  if (!status.upstream) return { eligible: false, reason: '未设置 upstream' };
  if (status.ahead <= 0) return { eligible: false, reason: '没有未推送提交' };
  if (status.behind > 0) return { eligible: false, reason: `落后远端 ${status.behind} 个提交` };
  return { eligible: true, reason: null };
}

export function getPullEligibility(status) {
  if (status.kind !== 'git') return { eligible: false, reason: '未初始化 Git' };
  if (status.detached) return { eligible: false, reason: 'detached HEAD' };
  if (status.operation) return { eligible: false, reason: `正在进行 ${status.operation}` };
  if (!status.upstream) return { eligible: false, reason: '未设置 upstream' };
  if (status.dirty) return { eligible: false, reason: '存在未提交文件' };
  if (status.ahead > 0) return { eligible: false, reason: `有 ${status.ahead} 个提交未推送` };
  if (status.behind <= 0) return { eligible: false, reason: '没有需要拉取的提交' };
  return { eligible: true, reason: null };
}

export async function pushRepository(path) {
  return git(path, ['push']);
}

export async function pullRepository(path) {
  return git(path, ['pull', '--ff-only']);
}
