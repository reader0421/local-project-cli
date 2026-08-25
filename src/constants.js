export const SCHEMA_VERSION = 1;

export const BUILTIN_OPENERS = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    command: 'open',
    args: ['-a', 'Visual Studio Code', '{path}'],
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    command: 'open',
    args: ['-a', 'PhpStorm', '{path}'],
  },
  {
    id: 'xcode',
    name: 'Xcode',
    command: 'open',
    args: ['-a', 'Xcode', '{path}'],
  },
  {
    id: 'wechat-devtools',
    name: '微信开发者工具',
    command: 'open',
    args: ['-a', '微信开发者工具', '{path}'],
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    command: 'open',
    args: ['-a', 'Android Studio', '{path}'],
  },
  {
    id: 'finder',
    name: 'Finder',
    command: 'open',
    args: ['{path}'],
  },
];

export function createEmptyRegistry() {
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: [],
    openers: structuredClone(BUILTIN_OPENERS),
    settings: {
      defaultOpenerId: 'vscode',
    },
  };
}
