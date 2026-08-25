import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitStatus, getPushEligibility, pushRepository } from '../src/git.js';

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
  await git(directory, 'add', 'README.md');
  await git(directory, 'commit', '-m', 'initial');
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src', 'new.js'), 'export {};\n');
  const status = await getGitStatus(directory);
  assert.equal(status.kind, 'git');
  assert.equal(status.branch, 'main');
  assert.equal(status.dirty, true);
  assert.equal(status.lastCommit.subject, 'initial');
  assert.equal(getPushEligibility(status).reason, '未设置 upstream');
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
  assert.equal(status.unpushedCommits[0].subject, 'local change');
  assert.deepEqual(getPushEligibility(status), { eligible: true, reason: null });
  await pushRepository(directory);
  const refreshed = await getGitStatus(directory);
  assert.equal(refreshed.ahead, 0);
  assert.equal(refreshed.unpushedCommits.length, 0);
});
