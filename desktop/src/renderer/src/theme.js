import { readonly, ref } from 'vue';

const STORAGE_KEY = 'local-project.theme';
const modes = ['system', 'light', 'dark'];
const preference = ref('system');
const resolved = ref('light');
export const themePreference = readonly(preference);
export const resolvedTheme = readonly(resolved);
export const themeError = ref('');
let systemTheme;
let cleanup;

function applyTheme() {
  resolved.value = preference.value === 'system'
    ? (systemTheme.matches ? 'dark' : 'light')
    : preference.value;
  document.documentElement.dataset.theme = resolved.value;
}

export function setThemePreference(value) {
  if (!modes.includes(value)) return;
  preference.value = value;
  applyTheme();
  themeError.value = '';
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    themeError.value = '外观已切换，但无法保存；下次启动可能需要重新选择。';
  }
}

export function initializeTheme() {
  cleanup?.();
  systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* 存储不可用时跟随系统。 */ }
  preference.value = modes.includes(saved) ? saved : 'system';
  applyTheme();
  systemTheme.addEventListener('change', applyTheme);
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference.value = modes.includes(event.newValue) ? event.newValue : 'system';
    applyTheme();
  };
  window.addEventListener('storage', onStorage);
  cleanup = () => {
    systemTheme.removeEventListener('change', applyTheme);
    window.removeEventListener('storage', onStorage);
  };
  return cleanup;
}

if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.());
