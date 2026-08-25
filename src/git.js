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

function parseChanges(lines) {
  const entries = [];
  for (const line of lines) {
    if (line.startsWith('? ')) entries.push({ code: '??', path: line.slice(2) });
    else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ');
      const code = parts[1];
      const tabIndex = line.lastIndexOf('\t');
      const path = tabIndex >= 0 ? line.slice(tabIndex + 1) : parts.at(-1);
      entries.push({ code, path });
    }
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

  const porcelain = await git(path, ['status', '--porcelain=v2', '--branch']);
  const lines = porcelain ? porcelain.split('\n') : [];
  const branch = parseBranch(lines);
  const changes = parseChanges(lines);
  let lastCommit = null;
  try {
    const raw = await git(path, ['log', '-1', '--format=%h%x1f%aI%x1f%s']);
    const [hash, authoredAt, subject] = raw.split('\x1f');
    if (hash) lastCommit = { hash, authoredAt, subject };
  } catch {
    // A repository without commits is valid.
  }
  let unpushedCommits = [];
  if (branch.upstream && branch.ahead > 0) {
    const raw = await git(path, ['log', '--format=%h%x1f%s', '@{upstream}..HEAD']);
    unpushedCommits = raw ? raw.split('\n').map((line) => {
      const [hash, subject] = line.split('\x1f');
      return { hash, subject };
    }) : [];
  }
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
    unpushedCommits,
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

export async function pushRepository(path) {
  return git(path, ['push']);
}
