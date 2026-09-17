// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import OperationProgress from './OperationProgress.vue';
import { state } from '../store.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  state.operation = null;
  state.scanning = false;
  vi.useRealTimers();
});

it('耗时操作显示对象和持续计时，完成后移除遮罩', async () => {
  vi.useFakeTimers();
  state.operation = { title: '正在运行 Webhook', detail: '测试项目 / 发布测试服', startedAt: Date.now() };
  wrapper = mount(OperationProgress, { global: { stubs: { teleport: true } } });
  expect(wrapper.find('.operation-backdrop').exists()).toBe(true);
  expect(wrapper.text()).toContain('测试项目 / 发布测试服');
  expect(wrapper.find('progress').attributes('value')).toBeUndefined();
  await vi.advanceTimersByTimeAsync(16000);
  expect(wrapper.text()).toContain('已等待 16 秒');
  expect(wrapper.text()).toContain('操作仍在执行');
  state.operation = null;
  await nextTick();
  expect(wrapper.find('.operation-backdrop').exists()).toBe(false);
});

it('远端扫描显示真实进度，启动扫描不阻断界面', async () => {
  state.scanning = true;
  state.scanBlocking = true;
  state.scanStartedAt = Date.now();
  state.scanProgress = { completed: 2, total: 5 };
  wrapper = mount(OperationProgress, { global: { stubs: { teleport: true } } });
  expect(wrapper.text()).toContain('正在获取远端并更新差异');
  expect(wrapper.find('progress').attributes('value')).toBe('2');
  expect(wrapper.find('progress').attributes('max')).toBe('5');
  state.scanBlocking = false;
  await nextTick();
  expect(wrapper.find('.operation-backdrop').exists()).toBe(false);
  expect(wrapper.find('.operation-background').exists()).toBe(true);
});
