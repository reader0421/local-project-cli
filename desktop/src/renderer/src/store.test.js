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

it('远端刷新传递 fetch，保留差异并明确报告局部失败', async () => {
  vi.resetModules();
  const startScan = vi.fn(async () => ({ entries: [{ project: { name: '项目' }, repositories: [
    { repository: { id: 'ok', name: '成功库' }, status: { kind: 'git', ahead: 2, behind: 3 } },
    { repository: { id: 'failed', name: '失败库' }, status: { kind: 'git', fetchError: '远端连接失败' } },
  ] }] }));
  vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: { startScan } });
  try {
    const store = await import('./store.js');
    await store.startScan({ fetch: true });
    expect(startScan).toHaveBeenCalledWith({ fetch: true });
    expect(store.state.statusByRepository.ok.behind).toBe(3);
    expect(store.state.scanFailures).toEqual([{ name: '项目/失败库', message: '远端连接失败' }]);
    expect(store.state.notice.kind).toBe('error');
    expect(store.interactionBlocked.value).toBe(false);
  } finally { vi.unstubAllGlobals(); vi.resetModules(); }
});

it('操作全程保留 loading，阻止重复执行，失败后解除遮罩并提示错误', async () => {
  vi.resetModules();
  vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: {} });
  try {
    const store = await import('./store.js');
    const pending = deferred();
    const operation = store.runAction(async () => { await pending.promise; throw new Error('网络失败'); }, null, { title: '正在推送', detail: '仓库 A' });
    expect(store.interactionBlocked.value).toBe(true);
    expect(store.state.operation.title).toBe('正在推送');
    const duplicate = vi.fn();
    await store.withOperation('重复操作', '', duplicate);
    expect(duplicate).not.toHaveBeenCalled();
    pending.resolve();
    await expect(operation).rejects.toThrow('网络失败');
    expect(store.state.operation).toBeNull();
    expect(store.interactionBlocked.value).toBe(false);
    expect(store.state.notice.message).toBe('网络失败');
  } finally { vi.unstubAllGlobals(); vi.resetModules(); }
});
