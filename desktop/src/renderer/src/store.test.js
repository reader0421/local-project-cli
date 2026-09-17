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

  it('使用启动排序展示，自动选择不计数，真实切换和返回详情各计一次', async () => {
    const recordRepositoryVisit = vi.fn(async () => {});
    const registry = { projects: [
      { id: 'p1', repositories: [{ id: 'r1' }, { id: 'r2' }] },
      { id: 'p2', repositories: [{ id: 'r3' }] },
    ] };
    const snapshot = { registry, registryPath: '/test.json', projectOrder: ['p2', 'p1'] };
    vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: {
      getState: async () => snapshot,
      startScan: async () => ({ entries: [] }),
      recordRepositoryVisit,
    } });
    const store = await import('./store.js');
    await store.initialize();
    expect(store.projects.value.map((project) => project.id)).toEqual(['p2', 'p1']);
    expect(store.state.selectedRepositoryId).toBe('r3');
    expect(recordRepositoryVisit).not.toHaveBeenCalled();
    store.selectProject('p1');
    store.selectRepository('p1', 'r1');
    store.selectRepository('p1', 'r2');
    store.selectRepository('p1', 'missing');
    store.navigateTo('settings');
    store.navigateTo('projects');
    expect(recordRepositoryVisit.mock.calls).toEqual([['r1'], ['r2'], ['r2']]);
    await store.runAction(async () => snapshot);
    expect(store.projects.value.map((project) => project.id)).toEqual(['p2', 'p1']);
    expect(registry.projects.map((project) => project.id)).toEqual(['p1', 'p2']);
  });

  it('窗口重建先完成注册表读取再接收菜单栏目标，不被启动扫描覆盖', async () => {
    let onNavigate;
    const cleanup = vi.fn();
    const scan = deferred();
    const recordRepositoryVisit = vi.fn(async () => {});
    const registry = { projects: [{ id: 'p', repositories: [{ id: 'r1' }, { id: 'r2' }] }] };
    vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: {
      getState: async () => ({ registry, registryPath: '/test.json' }),
      startScan: () => scan.promise,
      recordRepositoryVisit,
      onRepositoryNavigate: (listener) => { onNavigate = listener; return cleanup; },
      navigationReady: async () => ({ projectId: 'p', repositoryId: 'r2' }),
    } });
    const store = await import('./store.js');
    const initialization = store.initialize();
    await vi.waitFor(() => expect(store.state.selectedRepositoryId).toBe('r2'));
    expect(recordRepositoryVisit).toHaveBeenCalledExactlyOnceWith('r2');
    expect(store.state.repositoryNavigationSequence).toBe(1);
    scan.resolve({ entries: [] });
    const dispose = await initialization;
    expect(store.state.selectedRepositoryId).toBe('r2');
    store.navigateTo('settings');
    await onNavigate({ projectId: 'p', repositoryId: 'r1' });
    expect(store.state.navigation).toBe('projects');
    expect(store.state.selectedRepositoryId).toBe('r1');
    expect(store.state.repositoryNavigationSequence).toBe(2);
    dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('先展示注册表页面，再 fetch 并渐进更新 Git 状态', async () => {
    const scan = deferred();
    const startScan = vi.fn(() => scan.promise);
    let progressListener;
    const repository = { id: 'repo-1', name: 'repo-1', path: '/tmp/repo-1' };
    const project = { id: 'project-1', name: 'Project 1', repositories: [repository] };
    const registry = { projects: [project], openers: [], settings: {} };

    vi.stubGlobal('window', {
      setTimeout,
      localProject: {
        getState: async () => ({ registry, registryPath: '/tmp/registry.json', schemaVersion: 1, desktopVersion: '0.1.0' }),
        startScan,
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
    expect(startScan).toHaveBeenCalledExactlyOnceWith({ fetch: true });
    expect(store.interactionBlocked.value).toBe(false);

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

it('全局刷新默认 fetch，保留差异并明确报告局部失败', async () => {
  vi.resetModules();
  const startScan = vi.fn(async () => ({ entries: [{ project: { name: '项目' }, repositories: [
    { repository: { id: 'ok', name: '成功库' }, status: { kind: 'git', ahead: 2, behind: 3 } },
    { repository: { id: 'failed', name: '失败库' }, status: { kind: 'git', fetchError: '远端连接失败' } },
  ] }] }));
  vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: { startScan } });
  try {
    const store = await import('./store.js');
    await store.startScan();
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

it('详情页刷新默认 fetch，只更新指定代码库，失败保留原状态', async () => {
  vi.resetModules();
  const local = { kind: 'git', ahead: 1, behind: 0 };
  const remote = { kind: 'git', ahead: 1, behind: 2 };
  const getRepositoryStatus = vi.fn(async () => local);
  const fetchRepository = vi.fn(async () => remote);
  const startScan = vi.fn();
  vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: { getRepositoryStatus, fetchRepository, startScan } });
  try {
    const store = await import('./store.js');
    store.state.registry.projects = [{ id: 'p', name: '项目', repositories: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }];
    store.state.statusByRepository.b = { kind: 'git', ahead: 5 };
    await store.refreshRepository('a');
    expect(getRepositoryStatus).not.toHaveBeenCalled();
    expect(fetchRepository).toHaveBeenCalledExactlyOnceWith('a');
    expect(store.state.statusByRepository.a).toEqual(remote);
    expect(store.state.statusByRepository.b).toEqual({ kind: 'git', ahead: 5 });
    expect(startScan).not.toHaveBeenCalled();
    expect(store.state.lastScanCompletedAt).toBeNull();
    fetchRepository.mockRejectedValueOnce(new Error('获取远端失败'));
    await expect(store.refreshRepository('a')).rejects.toThrow('获取远端失败');
    expect(store.state.statusByRepository.a).toEqual(remote);
    expect(store.state.notice).toEqual({ kind: 'error', message: '获取远端失败' });
    expect(store.state.operation).toBeNull();
  } finally { vi.unstubAllGlobals(); vi.resetModules(); }
});

it('注册表更新只清理失效仓库缓存，切换注册表时清空缓存，不扫描 Git', async () => {
  vi.resetModules();
  const startScan = vi.fn();
  vi.stubGlobal('window', { setTimeout: vi.fn(), localProject: { startScan } });
  try {
    const store = await import('./store.js');
    const snapshot = (registryPath, repositories) => ({ registryPath, registry: { projects: [{ id: 'p', repositories }], openers: [], settings: {} } });
    const a = { id: 'a', path: '/tmp/a' };
    const b = { id: 'b', path: '/tmp/b' };
    const c = { id: 'c', path: '/tmp/c' };
    await store.runAction(async () => snapshot('/tmp/registry.json', [a, b, c]));
    store.state.statusByRepository = { a: { kind: 'git', ahead: 1 }, b: { kind: 'git' }, c: { kind: 'git' } };
    const retained = store.state.statusByRepository.a;
    await store.runAction(async () => snapshot('/tmp/registry.json', [a, { ...b, path: '/tmp/b-new' }]));
    expect(store.state.statusByRepository).toEqual({ a: retained });
    expect(store.state.statusByRepository.a).toBe(retained);
    store.state.lastScanCompletedAt = '2026-09-15T00:00:00.000Z';
    await store.runAction(async () => snapshot('/tmp/other.json', [a]));
    expect(store.state.statusByRepository).toEqual({});
    expect(store.state.lastScanCompletedAt).toBeNull();
    expect(startScan).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); vi.resetModules(); }
});
