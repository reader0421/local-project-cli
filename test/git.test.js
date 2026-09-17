import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchRepository, getGitStatus, getPullEligibility, getPushEligibility, pullRepository, pushRepository } from '../src/git.js';
import { scanRegistry } from '../src/scanner.js';

const exec = promisify(execFile);

async function git(cwd, ...args) {
  await exec('git', ['-C', cwd, ...args]);
}

test('non-git directory is a valid status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-non-git-'));
  assert.deepEqual(await getGitStatus(directory), { kind: 'non_git', path: directory });
});

test('fetch skips non-Git directories and repositories without remotes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-fetch-skip-'));
  assert.deepEqual(await fetchRepository(directory), { skipped: 'non_git' });
  await git(directory, 'init', '-b', 'main');
  assert.deepEqual(await fetchRepository(directory), { skipped: 'no_remote' });
  const status = await getGitStatus(directory);
  assert.equal(status.kind, 'git');
  assert.equal(status.lastCommit, null);
  const remote = await mkdtemp(join(tmpdir(), 'local-project-cli-empty-remote-'));
  await git(remote, 'init', '--bare');
  await git(directory, 'remote', 'add', 'origin', remote);
  assert.deepEqual(await fetchRepository(directory), { skipped: null });
});

test('fetch works without an upstream or a matching remote branch and does not modify the worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-project-cli-fetch-untracked-'));
  const remote = join(root, 'remote.git');
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  await exec('git', ['init', '--bare', remote]);
  await mkdir(source);
  await git(source, 'init', '-b', 'main');
  await git(source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'remote commit');
  await git(source, 'push', remote, 'main');
  await mkdir(checkout);
  await git(checkout, 'init', '-b', 'local-only');
  await git(checkout, 'remote', 'add', 'origin', remote);
  await writeFile(join(checkout, 'draft.txt'), 'keep this change');
  assert.deepEqual(await fetchRepository(checkout), { skipped: null });
  const status = await getGitStatus(checkout);
  assert.equal(status.upstream, null);
  assert.equal(status.branch, 'local-only');
  assert.equal(status.lastCommit, null);
  assert.equal(await readFile(join(checkout, 'draft.txt'), 'utf8'), 'keep this change');
  const { stdout } = await exec('git', ['-C', checkout, 'log', '-1', '--format=%s', 'origin/main']);
  assert.equal(stdout.trim(), 'remote commit');
});

test('a stalled fetch terminates its descendants and the scan finishes with local status and an error', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'local-project-cli-fetch-timeout-'));
  const remote = join(root, 'remote.git');
  const directory = join(root, 'work');
  const transport = join(root, 'transport.cjs');
  const pidFile = join(root, 'pids.json');
  await mkdir(directory);
  await exec('git', ['init', '--bare', remote]);
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'remote', 'add', 'origin', remote);
  await writeFile(transport, `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await git(directory, 'config', 'remote.origin.uploadpack', `${quote(process.execPath)} ${quote(transport)}`);
  t.after(async () => {
    const pids = JSON.parse(await readFile(pidFile, 'utf8').catch(() => '[]'));
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  });
  const startedAt = Date.now();
  const progress = [];
  const entries = await scanRegistry({ projects: [{ repositories: [
    { id: 'stalled', path: directory },
    { id: 'non-git', path: root },
  ] }] }, {
    fetch: true,
    fetchStatus: (path) => fetchRepository(path, { timeoutMs: 1000 }),
    onProgress: (value) => progress.push(value),
  });
  assert.equal(entries[0].repositories[0].status.kind, 'git');
  assert.match(entries[0].repositories[0].status.fetchError, /获取远端超时/);
  assert.equal(entries[0].repositories[1].status.kind, 'non_git');
  assert.equal(entries[0].repositories[1].status.fetchError, undefined);
  assert.equal(progress.at(-1).completed, 2);
  assert.ok(Date.now() - startedAt < 4000);
  const pids = JSON.parse(await readFile(pidFile, 'utf8'));
  // 等待系统回收已被终止的后代进程。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (pids.every((pid) => { try { process.kill(pid, 0); return false; } catch { return true; } })) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('HTTP fetch uses HTTP/1.1 and fails authentication without opening an askpass prompt', { timeout: 10_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-fetch-auth-'));
  const marker = join(directory, 'prompted');
  const askpass = join(directory, 'askpass.sh');
  const versions = [];
  const server = createServer((request, response) => {
    versions.push(request.httpVersion);
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"', Connection: 'close' });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'remote', 'add', 'origin', `http://127.0.0.1:${server.address().port}/test.git`);
  await git(directory, 'config', 'credential.helper', '');
  await git(directory, 'config', 'http.proxy', '');
  await writeFile(askpass, '#!/bin/sh\ntouch "$(dirname "$0")/prompted"\necho secret\n', { mode: 0o755 });
  await git(directory, 'config', 'core.askPass', askpass);
  await assert.rejects(fetchRepository(directory, { timeoutMs: 3000 }), /terminal prompts disabled|unable to get password from user/);
  assert.ok(versions.length > 0);
  assert.ok(versions.every((version) => version === '1.1'));
  await assert.rejects(access(marker), { code: 'ENOENT' });
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
