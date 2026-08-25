import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProject, addRepository, findRepository, loadRegistry, resolveRegistryPath, saveRegistry } from '../src/registry.js';

test('registry environment variable is namespaced to Local Project CLI', () => {
  assert.match(resolveRegistryPath(null, {}), /\/\.local-project-cli\/registry\.json$/);
  assert.equal(
    resolveRegistryPath(null, { LOCAL_PROJECT_CLI_REGISTRY: '/tmp/local-project-cli.json' }),
    '/tmp/local-project-cli.json',
  );
  assert.equal(
    resolveRegistryPath('/tmp/explicit.json', { LOCAL_PROJECT_CLI_REGISTRY: '/tmp/environment.json' }),
    '/tmp/explicit.json',
  );
});

test('registry can use an explicitly selected JSON file and add non-git directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-registry-'));
  const registryPath = join(directory, 'custom.json');
  const repositoryPath = join(directory, 'plain-folder');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(repositoryPath));
  const registry = await loadRegistry(registryPath);
  const project = addProject(registry, { name: '测试项目' });
  await addRepository(registry, project, { name: '普通目录', path: repositoryPath });
  await saveRegistry(registryPath, registry);
  const reloaded = await loadRegistry(registryPath);
  assert.equal(reloaded.projects[0].name, '测试项目');
  assert.equal(findRepository(reloaded, '测试项目/普通目录').repository.path, await realpath(repositoryPath));
  assert.match(await readFile(registryPath, 'utf8'), /"schemaVersion": 1/);
});

test('legacy global last opener is removed instead of becoming the default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-migration-'));
  const registryPath = join(directory, 'legacy.json');
  const registry = await loadRegistry(join(directory, 'seed.json'));
  registry.settings = { lastOpenerId: 'phpstorm' };
  registry.projects.push({
    id: 'legacy-project',
    name: 'Legacy',
    slug: 'legacy',
    defaultOpenerId: 'xcode',
    repositories: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const migrated = await loadRegistry(registryPath);
  assert.deepEqual(migrated.settings, { defaultOpenerId: 'vscode' });
  assert.equal('defaultOpenerId' in migrated.projects[0], false);
  const persisted = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal('lastOpenerId' in persisted.settings, false);
});
