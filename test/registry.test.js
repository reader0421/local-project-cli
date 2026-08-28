import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addProject,
  addRepository,
  findRepository,
  loadRegistry,
  resolveRegistryPath,
  saveRegistry,
  updateProject,
  updateRepository,
} from '../src/registry.js';

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

test('projects and repositories can be renamed without changing stable ids or paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-rename-'));
  const repositoryPath = join(directory, 'repository');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(repositoryPath));
  const registry = await loadRegistry(join(directory, 'registry.json'));
  const project = addProject(registry, { name: '旧项目名' });
  const repository = await addRepository(registry, project, { name: '旧代码库名', path: repositoryPath });
  const projectId = project.id;
  const repositoryId = repository.id;

  updateProject(registry, project.id, { name: '新项目名' });
  updateRepository(registry, repository.id, { name: '新代码库名' });

  assert.equal(project.id, projectId);
  assert.equal(project.slug, '新项目名');
  assert.equal(repository.id, repositoryId);
  assert.equal(repository.slug, '新代码库名');
  assert.equal(repository.path, await realpath(repositoryPath));
  assert.equal(findRepository(registry, '新项目名/新代码库名').repository.id, repositoryId);
});

test('legacy last opener history is removed instead of becoming an explicit default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-migration-'));
  const registryPath = join(directory, 'legacy.json');
  const registry = await loadRegistry(join(directory, 'seed.json'));
  registry.settings = { lastOpenerId: 'phpstorm' };
  registry.projects.push({
    id: 'legacy-project',
    name: 'Legacy',
    slug: 'legacy',
    defaultOpenerId: 'xcode',
    repositories: [{
      id: 'legacy-repository',
      name: 'Legacy Repository',
      slug: 'legacy-repository',
      path: '/tmp/legacy-repository',
      lastOpenerId: 'phpstorm',
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const migrated = await loadRegistry(registryPath);
  assert.deepEqual(migrated.settings, { defaultOpenerId: 'vscode' });
  assert.equal('defaultOpenerId' in migrated.projects[0], false);
  assert.equal('defaultOpenerId' in migrated.projects[0].repositories[0], false);
  assert.equal('lastOpenerId' in migrated.projects[0].repositories[0], false);
  const persisted = JSON.parse(await readFile(registryPath, 'utf8'));
  assert.equal('lastOpenerId' in persisted.settings, false);
  assert.equal('defaultOpenerId' in persisted.projects[0].repositories[0], false);
});

test('repository default opener can only be explicitly set or cleared', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-repository-opener-'));
  const repositoryPath = join(directory, 'repository');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(repositoryPath));
  const registry = await loadRegistry(join(directory, 'registry.json'));
  const project = addProject(registry, { name: 'Demo' });
  const repository = await addRepository(registry, project, { name: 'app', path: repositoryPath });

  assert.equal('defaultOpenerId' in repository, false);
  updateRepository(registry, repository.id, { defaultOpenerId: 'phpstorm' });
  assert.equal(repository.defaultOpenerId, 'phpstorm');
  updateRepository(registry, repository.id, { defaultOpenerId: null });
  assert.equal('defaultOpenerId' in repository, false);
  assert.throws(
    () => updateRepository(registry, repository.id, { defaultOpenerId: 'missing-opener' }),
    /找不到打开工具/,
  );
});

test('a stale registry instance cannot overwrite changes saved by another process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-project-cli-conflict-'));
  const registryPath = join(directory, 'registry.json');
  const first = await loadRegistry(registryPath);
  const stale = await loadRegistry(registryPath);

  addProject(first, { name: 'First writer' });
  await saveRegistry(registryPath, first);

  addProject(stale, { name: 'Stale writer' });
  await assert.rejects(
    saveRegistry(registryPath, stale),
    (error) => error.code === 'REGISTRY_CONFLICT' && /重新读取/.test(error.message),
  );

  const persisted = await loadRegistry(registryPath);
  assert.deepEqual(persisted.projects.map((project) => project.name), ['First writer']);
});
