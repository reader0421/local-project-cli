import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry, addProject, addRepository, validateRegistry } from '../src/registry.js';
import { saveRepositoryCommand, removeRepositoryCommand, findRepositoryCommand, validateTerminal } from '../src/repository-commands.js';

test('commands persist per repository, support editing/deletion, and preserve legacy compatibility', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repo-commands-'));
  try {
    const path = join(root, 'registry.json');
    const registry = await loadRegistry(path);
    const project = addProject(registry, { name: '示例' });
    const repository = await addRepository(registry, project, { name: 'repo', path: root });
    const other = { commands: [] };
    const item = saveRepositoryCommand(repository, { name: '启动开发', command: 'pnpm dev' });
    assert.throws(() => findRepositoryCommand(other, item.id), /找不到/);
    assert.throws(() => saveRepositoryCommand(repository, { name: '启动开发', command: 'pnpm build' }), /重复/);
    saveRepositoryCommand(repository, { name: '构建', command: 'pnpm build' }, item.id);
    registry.settings.defaultTerminalId = validateTerminal('ghostty');
    await saveRegistry(path, registry);
    const restored = await loadRegistry(path);
    assert.equal(restored.settings.defaultTerminalId, 'ghostty');
    const repo = restored.projects[0].repositories[0];
    assert.deepEqual(findRepositoryCommand(repo, item.id), { id: item.id, name: '构建', command: 'pnpm build' });
    removeRepositoryCommand(repo, item.id);
    await saveRegistry(path, restored);
    assert.deepEqual((await loadRegistry(path)).projects[0].repositories[0].commands, []);
    delete repo.commands;
    delete restored.settings.defaultTerminalId;
    assert.doesNotThrow(() => validateRegistry(restored));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reject invalid commands and unsupported terminals before mutating data', () => {
  const repository = {};
  for (const input of [{ name: '', command: 'pnpm dev' }, { name: '开发', command: '' }, { name: '开发', command: 'bad\0command' }]) {
    assert.throws(() => saveRepositoryCommand(repository, input));
    assert.equal(repository.commands, undefined);
  }
  assert.throws(() => validateTerminal('unknown'));
});
