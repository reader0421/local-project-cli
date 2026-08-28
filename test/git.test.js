import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRepository, getGitStatus, getPullEligibility, getPushEligibility, pullRepository, pushRepository } from '../src/git.js';

const exec = promisify(execFile);

async function git(cwd, ...args) {
  await exec('git', ['-C', cwd, ...args]);
}

test('non-git directory is a valid status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-non-git-'));
  assert.deepEqual(await getGitStatus(directory), { kind: 'non_git', path: directory });
});

test('git status reports branch, dirty files and last commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-git-'));
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await git(directory, 'config', 'user.name', 'Test');
  await writeFile(join(directory, 'README.md'), 'hello\n');
  await mkdir(join(directory, '中文目录'));
  await writeFile(join(directory, '中文目录', '中文 文件.swift'), 'let value = 1\n');
  await git(directory, 'add', 'README.md', '中文目录/中文 文件.swift');
  await git(directory, 'commit', '-m', 'initial');
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src', 'new.js'), 'export {};\n');
  await writeFile(join(directory, '中文目录', '中文 文件.swift'), 'let value = 2\n');
  const status = await getGitStatus(directory);
  assert.equal(status.kind, 'git');
  assert.equal(status.branch, 'main');
  assert.equal(status.dirty, true);
  assert.ok(status.changes.some((change) => change.path === '中文目录/中文 文件.swift'));
  assert.equal(status.lastCommit.subject, 'initial');
  assert.equal(status.lastCommit.author, 'Test');
  assert.equal(status.recentCommits.length, 1);
  assert.equal(getPushEligibility(status).reason, '未设置 upstream');
});

test('git status returns the five most recent commits in newest-first order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-recent-'));
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await git(directory, 'config', 'user.name', 'Test');
  for (let index = 1; index <= 7; index += 1) {
    await git(directory, 'commit', '--allow-empty', '-m', `commit ${index}`);
  }

  const status = await getGitStatus(directory);
  assert.equal(status.recentCommits.length, 5);
  assert.deepEqual(status.recentCommits.map((commit) => commit.subject), [
    'commit 7',
    'commit 6',
    'commit 5',
    'commit 4',
    'commit 3',
  ]);
  assert.deepEqual(status.lastCommit, status.recentCommits[0]);
});

test('git status reports unpushed commits and allows a safe push plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-project-cli-ahead-'));
  const remote = join(root, 'remote.git');
  const directory = join(root, 'work');
  await mkdir(directory);
  await exec('git', ['init', '--bare', remote]);
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await git(directory, 'config', 'user.name', 'Test');
  await writeFile(join(directory, 'README.md'), 'hello\n');
  await git(directory, 'add', 'README.md');
  await git(directory, 'commit', '-m', 'initial');
  await git(directory, 'remote', 'add', 'origin', remote);
  await git(directory, 'push', '-u', 'origin', 'main');
  await writeFile(join(directory, 'README.md'), 'hello again\n');
  await git(directory, 'add', 'README.md');
  await git(directory, 'commit', '-m', 'local change');
  const status = await getGitStatus(directory);
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 0);
  assert.equal(status.upstreamCommit.subject, 'initial');
  assert.equal(status.upstreamCommit.author, 'Test');
  assert.equal(status.unpushedCommits[0].subject, 'local change');
  assert.deepEqual(getPushEligibility(status), { eligible: true, reason: null });
  await pushRepository(directory);
  const refreshed = await getGitStatus(directory);
  assert.equal(refreshed.ahead, 0);
  assert.equal(refreshed.unpushedCommits.length, 0);
});

test('safe pull only accepts a clean, strictly-behind branch and fast-forwards it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-project-cli-pull-'));
  const remote = join(root, 'remote.git');
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  await mkdir(source);
  await exec('git', ['init', '--bare', remote]);
  await git(source, 'init', '-b', 'main');
  await git(source, 'config', 'user.email', 'test@example.com');
  await git(source, 'config', 'user.name', 'Test');
  await writeFile(join(source, 'README.md'), 'one\n');
  await git(source, 'add', 'README.md');
  await git(source, 'commit', '-m', 'initial');
  await git(source, 'remote', 'add', 'origin', remote);
  await git(source, 'push', '-u', 'origin', 'main');
  await exec('git', ['clone', '--branch', 'main', remote, checkout]);
  for (let index = 1; index <= 12; index += 1) {
    await git(source, 'commit', '--allow-empty', '-m', `remote change ${index}`);
  }
  await git(source, 'push');
  await fetchRepository(checkout);
  const behind = await getGitStatus(checkout);
  assert.equal(behind.behind, 12);
  assert.equal(behind.remoteCommits.length, 12);
  assert.equal(behind.remoteCommits[0].subject, 'remote change 12');
  assert.equal(behind.remoteCommits[11].subject, 'remote change 1');
  assert.equal(behind.remoteCommits[0].author, 'Test');
  assert.deepEqual(getPullEligibility(behind), { eligible: true, reason: null });
  await pullRepository(checkout);
  const pulled = await getGitStatus(checkout);
  assert.equal(pulled.behind, 0);
  assert.equal(pulled.remoteCommits.length, 0);
  assert.equal(pulled.lastCommit.subject, 'remote change 12');
  await writeFile(join(checkout, 'README.md'), 'dirty\n');
  assert.equal(getPullEligibility(await getGitStatus(checkout)).reason, '存在未提交文件');
});
