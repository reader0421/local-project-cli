import { randomUUID } from 'node:crypto';

export const TERMINAL_IDS = ['terminal', 'ghostty'];

export function validateTerminal(id) {
  if (!TERMINAL_IDS.includes(id)) throw new Error('默认终端只能选择 Terminal 或 Ghostty');
  return id;
}

function commandInput(input) {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('命令名称不能为空');
  if (typeof input.command !== 'string' || !input.command.trim()) throw new Error('执行命令不能为空');
  if (input.name.length > 100 || input.command.length > 16000) throw new Error('命令名称或内容过长');
  if (input.name.includes('\0') || input.command.includes('\0')) throw new Error('命令不能包含空字符');
  return { name: input.name.trim(), command: input.command.trim() };
}

export function validateRepositoryCommands(commands) {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) throw new Error('代码库 commands 必须是数组');
  const ids = new Set();
  const names = new Set();
  for (const item of commands) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('代码库命令 id 无效或重复');
    const { name } = commandInput(item);
    if (names.has(name.toLocaleLowerCase())) throw new Error(`命令名称重复：${name}`);
    ids.add(item.id);
    names.add(name.toLocaleLowerCase());
  }
}

export function findRepositoryCommand(repository, id) {
  const command = (repository.commands || []).find((item) => item.id === id);
  if (!command) throw new Error('找不到自定义命令，请重新读取代码库');
  return command;
}

export function saveRepositoryCommand(repository, input, id) {
  const previous = id ? findRepositoryCommand(repository, id) : null;
  const values = commandInput(input);
  const item = { id: previous?.id || randomUUID(), ...values };
  const commands = previous
    ? repository.commands.map((command) => command.id === id ? item : command)
    : [...(repository.commands || []), item];
  validateRepositoryCommands(commands);
  repository.commands = commands;
  repository.updatedAt = new Date().toISOString();
  return item;
}

export function removeRepositoryCommand(repository, id) {
  const command = findRepositoryCommand(repository, id);
  repository.commands = repository.commands.filter((item) => item.id !== id);
  repository.updatedAt = new Date().toISOString();
  return command;
}
