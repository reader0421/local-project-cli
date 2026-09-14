// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

let dispose;
afterEach(() => {
  dispose?.();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function setup(dark = false, saved) {
  const media = new EventTarget();
  media.matches = dark;
  vi.stubGlobal('matchMedia', () => media);
  if (saved) window.localStorage.setItem('local-project.theme', saved);
  const theme = await import('./theme.js');
  dispose = theme.initializeTheme();
  return { theme, changeSystem(value) {
    media.matches = value;
    media.dispatchEvent(new Event('change'));
  } };
}

describe('外观模式', () => {
  it('默认跟随系统，系统切换后立即更新', async () => {
    const { theme, changeSystem } = await setup();
    expect(theme.themePreference.value).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    changeSystem(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('手动模式持久化且不受系统变化影响，可恢复跟随系统', async () => {
    const { theme, changeSystem } = await setup(true);
    theme.setThemePreference('light');
    expect(window.localStorage.getItem('local-project.theme')).toBe('light');
    changeSystem(false);
    changeSystem(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    dispose = theme.initializeTheme();
    expect(theme.themePreference.value).toBe('light');
    theme.setThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    theme.setThemePreference('dark');
    changeSystem(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('无效配置回退到系统模式', async () => {
    const { theme } = await setup(true, 'invalid');
    expect(theme.themePreference.value).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    theme.setThemePreference('invalid');
    expect(theme.themePreference.value).toBe('system');
  });

  it('无法保存时仍可切换，并显示保存失败提示', async () => {
    const { theme } = await setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    theme.setThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(theme.themeError.value).toContain('无法保存');
  });

  it('清理后停止监听系统变化', async () => {
    const { changeSystem } = await setup();
    dispose();
    changeSystem(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
