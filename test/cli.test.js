import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const cli = resolve('bin/project.js');

async function run(registry, ...args) {
  return exec(process.execPath, [cli, '--registry', registry, ...args], { encoding: 'utf8' });
}

test('CLI exposes help and package version without creating a registry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-meta-'));
  const registry = join(directory, 'registry.json');
  assert.match((await run(registry, '--help')).stdout, /Local Project CLI/);
  assert.equal((await run(registry, '--version')).stdout.trim(), '0.2.0');
  await assert.rejects(readFile(registry, 'utf8'), /ENOENT/);
});

test('CLI creates a project, adds a non-git directory, lists and inspects it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-e2e-'));
  const registry = join(directory, 'registry.json');
  const plain = join(directory, 'plain');
  await mkdir(plain);

  assert.match((await run(registry, 'add', 'project', '本地工具')).stdout, /已添加项目/);
  assert.match((await run(registry, 'add', 'repo', plain, '--project', '本地工具', '--name', 'notes')).stdout, /未初始化 Git/);
  assert.match((await run(registry, 'list')).stdout, /notes.*未初始化 Git/);
  assert.match((await run(registry, 'inspect', '本地工具\/notes')).stdout, /Git\s+未初始化 Git/);

  const data = JSON.parse(await readFile(registry, 'utf8'));
  assert.equal(data.projects.length, 1);
  assert.equal(data.projects[0].repositories.length, 1);
});

test('opener dry-run uses the configured command without launching an app', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-open-'));
  const registry = join(directory, 'registry.json');
  const plain = join(directory, 'plain');
  await mkdir(plain);
  await run(registry, 'add', 'project', 'Demo');
  await run(registry, 'add', 'repo', plain, '--project', 'Demo', '--name', 'app');
  const result = await run(registry, 'open', 'Demo/app', '--with', 'wechat-devtools', '--dry-run');
  assert.match(result.stdout, /微信开发者工具/);
  assert.match(result.stdout, /将执行/);
  const data = JSON.parse(await readFile(registry, 'utf8'));
  assert.equal('defaultOpenerId' in data.projects[0].repositories[0], false);
});

test('CLI manages custom openers and the global default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-opener-'));
  const registry = join(directory, 'registry.json');

  await run(registry, 'opener', 'add', '--id', 'zed', '--name', 'Zed', '--command', 'zed', '--arg', '{path}');
  assert.match((await run(registry, 'opener', 'get', 'zed')).stdout, /名称\s+Zed/);
  await run(registry, 'opener', 'update', 'zed', '--name', 'Zed Editor', '--arg=--wait', '--arg', '{path}');
  assert.match((await run(registry, 'opener', 'get', 'zed', '--json')).stdout, /Zed Editor/);
  await run(registry, 'opener', 'default', 'zed');
  assert.match((await run(registry, 'opener', 'default')).stdout, /^zed\s/);
  await assert.rejects(run(registry, 'opener', 'remove', 'zed', '--yes'), /不能删除默认打开工具/);
  await run(registry, 'opener', 'default', 'vscode');
  await run(registry, 'opener', 'remove', 'zed', '--yes');
  assert.doesNotMatch((await run(registry, 'opener', 'list')).stdout, /^zed\s/m);

  await run(registry, 'opener', 'add', '--id', 'codex-cli', '--name', 'Codex CLI', '--command', 'codex', '--arg', '-C', '--arg', '{path}', '--mode', 'terminal');
  assert.match((await run(registry, 'opener', 'get', 'codex-cli')).stdout, /模式\s+terminal/);
});
