// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import ProjectsView from './ProjectsView.vue';
import PendingView from './PendingView.vue';
import { api, repositories, state } from '../store.js';

let wrapper;
let startScan;
const status = (overrides = {}) => ({ kind: 'git', branch: 'main', upstream: 'origin/main', ahead: 2, behind: 0, changes: [], ...overrides });

beforeEach(() => {
  vi.spyOn(window, 'setTimeout').mockImplementation(() => 0);
  startScan = vi.spyOn(api, 'startScan').mockResolvedValue({ entries: [] });
  state.registry = { projects: [{ id: 'p', name: '项目', repositories: ['a', 'b', 'c'].map((id) => ({ id, name: id, path: `/tmp/${id}` })) }], openers: [], settings: {} };
  state.selectedProjectId = 'p';
  state.selectedRepositoryId = 'a';
  state.statusByRepository = { a: status(), b: status(), c: status({ ahead: 0 }) };
  state.lastScanCompletedAt = '2026-09-15T00:00:00.000Z';
  state.scanning = false;
  state.operation = null;
});

afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});

it('详情页只保留刷新按钮，点击后 fetch 并只更新当前仓库', async () => {
  const updated = status({ ahead: 0, behind: 3 });
  const request = vi.spyOn(api, 'fetchRepository').mockResolvedValue(updated);
  const readStatus = vi.spyOn(api, 'getRepositoryStatus');
  const untouched = state.statusByRepository.b;
  wrapper = shallowMount(ProjectsView);
  expect(wrapper.find('[aria-label="获取远端状态"]').exists()).toBe(false);
  await wrapper.get('[aria-label="刷新当前代码库"]').trigger('click');
  await flushPromises();
  expect(request).toHaveBeenCalledExactlyOnceWith('a');
  expect(state.statusByRepository.a).toEqual(updated);
  expect(state.statusByRepository.b).toBe(untouched);
  expect(readStatus).not.toHaveBeenCalled();
  expect(startScan).not.toHaveBeenCalled();
  expect(state.lastScanCompletedAt).toBe('2026-09-15T00:00:00.000Z');
});

it.each([
  ['pushCurrent', 'pushRepository'],
  ['pullCurrent', 'pullRepository'],
])('详情页 %s 只使用当前仓库返回的状态，不触发全局刷新', async (action, method) => {
  const updated = status({ ahead: 0, behind: 0 });
  const request = vi.spyOn(api, method).mockResolvedValue(updated);
  const readStatus = vi.spyOn(api, 'getRepositoryStatus');
  const untouched = state.statusByRepository.b;
  wrapper = shallowMount(ProjectsView);
  await wrapper.vm[action]();
  expect(request).toHaveBeenCalledExactlyOnceWith('a');
  expect(state.statusByRepository.a).toEqual(updated);
  expect(state.statusByRepository.b).toBe(untouched);
  expect(readStatus).not.toHaveBeenCalled();
  expect(startScan).not.toHaveBeenCalled();
  expect(state.lastScanCompletedAt).toBe('2026-09-15T00:00:00.000Z');
});

it('推送期间切换选择，返回状态仍写入原仓库', async () => {
  let finish;
  vi.spyOn(api, 'pushRepository').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  wrapper = shallowMount(ProjectsView);
  const operation = wrapper.vm.pushCurrent();
  expect(state.operation).not.toBeNull();
  state.selectedRepositoryId = 'b';
  finish(status({ ahead: 0 }));
  await operation;
  expect(state.statusByRepository.a.ahead).toBe(0);
  expect(state.statusByRepository.b.ahead).toBe(2);
  expect(state.operation).toBeNull();
  expect(startScan).not.toHaveBeenCalled();
});

it('未推送页单仓库推送后立即移出待推送列表', async () => {
  vi.spyOn(api, 'pushRepository').mockResolvedValue(status({ ahead: 0 }));
  wrapper = shallowMount(PendingView);
  await wrapper.vm.pushOne(repositories.value[0]);
  expect(wrapper.findAll('.table-row')).toHaveLength(1);
  expect(wrapper.find('.table-row').text()).toContain('b');
  expect(state.statusByRepository.a.ahead).toBe(0);
  expect(startScan).not.toHaveBeenCalled();
});

it('批量推送只更新成功仓库，失败与未参与仓库保留状态', async () => {
  const request = vi.spyOn(api, 'pushRepository')
    .mockResolvedValueOnce(status({ ahead: 0 }))
    .mockRejectedValueOnce(new Error('远端拒绝推送'));
  const untouched = state.statusByRepository.c;
  wrapper = shallowMount(PendingView);
  await wrapper.vm.pushAll();
  expect(request.mock.calls).toEqual([['a'], ['b']]);
  expect(state.statusByRepository.a.ahead).toBe(0);
  expect(state.statusByRepository.b.ahead).toBe(2);
  expect(state.statusByRepository.c).toBe(untouched);
  expect(wrapper.vm.results.map(({ success }) => success)).toEqual([true, false]);
  expect(startScan).not.toHaveBeenCalled();
  expect(state.operation).toBeNull();
});

it.each(['pushCurrent', 'pullCurrent'])('%s 失败时保留缓存，显示错误并解除操作遮罩', async (action) => {
  const method = action === 'pushCurrent' ? 'pushRepository' : 'pullRepository';
  vi.spyOn(api, method).mockRejectedValue(new Error('远端操作失败'));
  const previous = state.statusByRepository.a;
  wrapper = shallowMount(ProjectsView);
  await expect(wrapper.vm[action]()).rejects.toThrow('远端操作失败');
  expect(state.statusByRepository.a).toBe(previous);
  expect(state.notice).toEqual({ kind: 'error', message: '远端操作失败' });
  expect(state.operation).toBeNull();
  expect(wrapper.vm.busy).toBe(false);
  expect(startScan).not.toHaveBeenCalled();
});

it('新增仓库后只 fetch 并更新新仓库状态', async () => {
  const repository = { id: 'new', name: '新仓库', path: '/tmp/new' };
  const registry = JSON.parse(JSON.stringify(state.registry));
  registry.projects[0].repositories.push(repository);
  vi.spyOn(api, 'addRepository').mockResolvedValue({ registry, registryPath: state.registryPath, result: repository });
  const fetchRepository = vi.spyOn(api, 'fetchRepository').mockResolvedValue(status({ ahead: 0 }));
  const untouched = state.statusByRepository.a;
  wrapper = shallowMount(ProjectsView);
  await wrapper.vm.addRepository();
  expect(fetchRepository).toHaveBeenCalledExactlyOnceWith('new');
  expect(state.selectedRepositoryId).toBe('new');
  expect(state.statusByRepository.new.ahead).toBe(0);
  expect(state.statusByRepository.a).toBe(untouched);
  expect(startScan).not.toHaveBeenCalled();
});
