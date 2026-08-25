import { spawn } from 'node:child_process';

const TERMINAL_APPLESCRIPT_ARGS = [
  '-e', 'on run argv',
  '-e', 'set commandParts to {}',
  '-e', 'repeat with currentArgument in argv',
  '-e', 'set end of commandParts to quoted form of (contents of currentArgument)',
  '-e', 'end repeat',
  '-e', "set previousDelimiters to AppleScript's text item delimiters",
  '-e', "set AppleScript's text item delimiters to \" \"",
  '-e', 'set commandText to commandParts as text',
  '-e', "set AppleScript's text item delimiters to previousDelimiters",
  '-e', 'tell application "Terminal"',
  '-e', 'activate',
  '-e', 'do script commandText',
  '-e', 'end tell',
  '-e', 'end run',
  '--',
];

export function resolveOpener(registry, project, repository, requestedId) {
  const openerId = requestedId
    || repository?.lastOpenerId
    || registry.settings.defaultOpenerId
    || 'vscode';
  const opener = registry.openers.find((item) => item.id === openerId);
  if (!opener) throw new Error(`找不到打开工具：${openerId}`);
  return opener;
}

export function buildOpenCommand(opener, path) {
  const directInvocation = {
    command: opener.command,
    args: opener.args.map((arg) => arg.replaceAll('{path}', path)),
  };
  if (opener.mode !== 'terminal') return directInvocation;
  return {
    command: '/usr/bin/osascript',
    args: [...TERMINAL_APPLESCRIPT_ARGS, directInvocation.command, ...directInvocation.args],
    displayCommand: directInvocation.command,
    displayArgs: directInvocation.args,
  };
}

export async function openPath(opener, path, { dryRun = false } = {}) {
  const invocation = buildOpenCommand(opener, path);
  if (dryRun) return invocation;
  const child = spawn(invocation.command, invocation.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return invocation;
}

export function addOpener(registry, { id, name, command, args, mode }) {
  const normalizedId = normalizeId(id);
  const normalizedName = requiredText(name, '名称');
  const normalizedCommand = requiredText(command, 'command');
  if (registry.openers.some((item) => item.id === normalizedId)) throw new Error(`打开工具已存在：${normalizedId}`);
  const opener = {
    id: normalizedId,
    name: normalizedName,
    command: normalizedCommand,
    args: normalizeArgs(args),
  };
  if (normalizeMode(mode) === 'terminal') opener.mode = 'terminal';
  registry.openers.push(opener);
  return opener;
}

export function findOpener(registry, id) {
  return registry.openers.find((item) => item.id === id) || null;
}

export function updateOpener(registry, id, changes = {}) {
  const opener = findOpener(registry, id);
  if (!opener) throw new Error(`找不到打开工具：${id}`);
  if (changes.name !== undefined) opener.name = requiredText(changes.name, '名称');
  if (changes.command !== undefined) opener.command = requiredText(changes.command, 'command');
  if (changes.args !== undefined) opener.args = normalizeArgs(changes.args);
  if (changes.mode !== undefined) {
    if (normalizeMode(changes.mode) === 'terminal') opener.mode = 'terminal';
    else delete opener.mode;
  }
  if (changes.name === undefined && changes.command === undefined && changes.args === undefined && changes.mode === undefined) {
    throw new Error('至少提供 --name、--command、--arg 或 --mode 中的一项');
  }
  return opener;
}

export function removeOpener(registry, id) {
  const opener = findOpener(registry, id);
  if (!opener) throw new Error(`找不到打开工具：${id}`);
  if (registry.settings.defaultOpenerId === id) {
    throw new Error(`不能删除默认打开工具：${id}；请先设置其他默认工具`);
  }
  const references = registry.projects.flatMap((project) => project.repositories
    .filter((repository) => repository.lastOpenerId === id)
    .map((repository) => `${project.name}/${repository.name}`));
  if (references.length) {
    throw new Error(`不能删除仍被代码库使用的打开工具：${references.join('、')}`);
  }
  registry.openers = registry.openers.filter((item) => item.id !== id);
  return opener;
}

export function setDefaultOpener(registry, id) {
  const opener = findOpener(registry, id);
  if (!opener) throw new Error(`找不到打开工具：${id}`);
  registry.settings.defaultOpenerId = id;
  return opener;
}

export function macOSApplicationOpener(application) {
  const normalized = requiredText(application, '应用名称或路径');
  return { command: 'open', args: ['-a', normalized, '{path}'] };
}

export function isMacOSApplicationOpener(opener) {
  return opener?.mode !== 'terminal'
    && opener?.command === 'open'
    && opener.args?.length === 3
    && opener.args[0] === '-a'
    && opener.args[2] === '{path}';
}

export function openerMode(opener) {
  return opener?.mode === 'terminal' ? 'terminal' : 'background';
}

function normalizeId(value) {
  const id = requiredText(value, 'id');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error('打开工具 id 只能包含字母、数字、点、下划线和连字符');
  }
  return id;
}

function requiredText(value, field) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`打开工具需要${field === 'id' ? ' ' : ''}${field}`);
  return normalized;
}

function normalizeArgs(args) {
  if (args === undefined) return ['{path}'];
  if (!Array.isArray(args) || !args.length) throw new Error('打开工具至少需要一个参数');
  return args.map((arg) => String(arg));
}

function normalizeMode(mode) {
  const normalized = mode || 'background';
  if (!['background', 'terminal'].includes(normalized)) {
    throw new Error('打开工具 mode 只能是 background 或 terminal');
  }
  return normalized;
}
