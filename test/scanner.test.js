import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRegistry } from '../src/scanner.js';

function registryWithRepositories(count) {
  return {
    projects: [{
      id: 'project',
      name: 'Project',
      repositories: Array.from({ length: count }, (_, index) => ({
        id: `repo-${index}`,
        name: `Repo ${index}`,
        path: `/repo/${index}`,
      })),
    }],
  };
}

test('registry scan limits concurrency, reports progress and preserves repository order', async () => {
  const registry = registryWithRepositories(8);
  const progress = [];
  let active = 0;
  let maxActive = 0;
  const entries = await scanRegistry(registry, {
    concurrency: 3,
    onProgress: ({ completed, total }) => progress.push([completed, total]),
    async getStatus(path) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, path.endsWith('/0') ? 15 : 1));
      active -= 1;
      return { kind: 'git', path };
    },
  });

  assert.equal(maxActive, 3);
  assert.deepEqual(progress[0], [0, 8]);
  assert.deepEqual(progress.at(-1), [8, 8]);
  assert.deepEqual(entries[0].repositories.map((item) => item.status.path), registry.projects[0].repositories.map((item) => item.path));
});

test('registry scan isolates Git failures to the affected repository', async () => {
  const registry = registryWithRepositories(2);
  const entries = await scanRegistry(registry, {
    async getStatus(path) {
      if (path.endsWith('/0')) throw new Error('cannot read');
      return { kind: 'non_git', path };
    },
  });

  assert.deepEqual(entries[0].repositories[0].status, {
    kind: 'error',
    path: '/repo/0',
    error: 'cannot read',
  });
  assert.equal(entries[0].repositories[1].status.kind, 'non_git');
});
