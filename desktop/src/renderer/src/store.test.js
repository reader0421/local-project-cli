import { afterEach, describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('renderer store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('先展示注册表页面，再渐进更新 Git 状态', async () => {
    const scan = deferred();
    let progressListener;
    const repository = { id: 'repo-1', name: 'repo-1', path: '/tmp/repo-1' };
    const project = { id: 'project-1', name: 'Project 1', repositories: [repository] };
    const registry = { projects: [project], openers: [], settings: {} };

    vi.stubGlobal('window', {
      setTimeout,
      localProject: {
        getState: async () => ({ registry, registryPath: '/tmp/registry.json', schemaVersion: 1, desktopVersion: '0.1.0' }),
        startScan: () => scan.promise,
        onScanProgress(listener) {
          progressListener = listener;
          return () => {};
        },
      },
    });

    const store = await import('./store.js');
    const initialization = store.initialize();

    await vi.waitFor(() => {
      expect(store.state.loading).toBe(false);
      expect(store.state.scanning).toBe(true);
      expect(store.state.selectedRepositoryId).toBe('repo-1');
    });

    const status = { kind: 'git', branch: 'main', ahead: 0, changes: [] };
    progressListener({ completed: 1, total: 1, project, repository, status });
    expect(store.state.statusByRepository['repo-1']).toEqual(status);
    expect(store.state.scanProgress).toEqual({ completed: 1, total: 1 });

    scan.resolve({ entries: [{ project, repositories: [{ repository, status }] }] });
    await initialization;

    expect(store.state.scanning).toBe(false);
    expect(store.state.scanProgress).toEqual({ completed: 1, total: 1 });
    expect(store.state.lastScanCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
