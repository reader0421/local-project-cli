import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { validateTerminal } from '../../../src/repository-commands.js';

const execFileAsync = promisify(execFile);

// 路径和用户命令通过独立参数传入，不拼接进 shell / AppleScript 源码。
export function buildTerminalCommand(terminalId, path, command, shell = '/bin/zsh') {
  validateTerminal(terminalId);
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('代码库路径无效');
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) throw new Error('执行命令无效');
  if (!['/bin/zsh', '/bin/bash'].includes(shell)) shell = '/bin/zsh';
  const script = 'cd -- "$1" || exit; eval "$2"; command_result=$?; printf "\\n命令已结束，退出码：%s\\n" "$command_result"; exec "$0" -il';
  const args = ['-ilc', script, shell, path, command];
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const commandText = [shell, ...args].map(quote).join(' ');
  if (terminalId === 'ghostty') {
    // macOS 会把裸路径参数识别为待打开文件。完整命令必须放进单个配置参数，
    // 不能使用 -e 后跟多个路径的形式，否则会额外打开 /bin 和 repo 标签。
    return { command: '/usr/bin/open', args: [
      '-na', 'Ghostty.app', '--args', `--working-directory=${path}`,
      `--initial-command=shell:${commandText}`,
    ] };
  }
  return { command: '/usr/bin/osascript', args: [
    '-e', 'on run argv', '-e', 'tell application "Terminal"',
    '-e', 'activate', '-e', 'do script (item 1 of argv)',
    '-e', 'end tell', '-e', 'end run', '--', commandText,
  ] };
}

export async function runInTerminal(terminalId, path, command, { execute = execFileAsync, shell = process.env.SHELL } = {}) {
  if (!(await stat(path)).isDirectory()) throw new Error('代码库根目录不存在或不是目录');
  const invocation = buildTerminalCommand(terminalId, path, command, shell);
  try {
    await execute(invocation.command, invocation.args, { timeout: 15000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    if (terminalId === 'ghostty') throw new Error('无法打开 Ghostty，请确认已安装，或在设置中选择 Terminal');
    throw new Error(`无法打开 Terminal，请检查系统自动化权限：${error.message}`);
  }
  return { terminalName: terminalId === 'ghostty' ? 'Ghostty' : 'Terminal' };
}
