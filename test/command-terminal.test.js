import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTerminalCommand, runInTerminal } from '../desktop/src/main/command-terminal.js';

test('Terminal safely preserves shell arguments, Chinese, quotes and literal substitutions', () => {
  const path = "/tmp/代码库 'quoted' $(touch SHOULD_NOT_RUN) {path}";
  const command = 'printf "%s" "a b"; echo \'{path}\'';
  const invocation = buildTerminalCommand('terminal', path, command);
  assert.equal(invocation.command, '/usr/bin/osascript');
  // Only parse the command line into argv, without executing the user command or opening a terminal.
  const args = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `set -- ${invocation.args.at(-1)}; printf '%s\\0' "$@"`]).toString().split('\0').slice(0, -1);
  assert.equal(args[0], '/bin/zsh');
  assert.equal(args[1], '-ilc');
  assert.equal(args.at(-2), path);
  assert.equal(args.at(-1), command);
  assert.ok(!invocation.args.slice(0, -1).join(' ').includes(command));
});

test('Ghostty invocation uses repository root and executes exact command in that directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-command-'));
  const path = join(root, "中文 repo 'quote' $literal");
  await mkdir(path);
  try {
    const invocation = buildTerminalCommand('ghostty', path, 'pwd > result.txt; exit 0');
    assert.deepEqual(invocation.args.slice(0, 4), ['-na', 'Ghostty.app', '--args', `--working-directory=${path}`]);
    const ghosttyArgs = invocation.args.slice(3);
    assert.equal(ghosttyArgs.length, 2);
    assert.ok(ghosttyArgs.every((arg) => arg.startsWith('--') && arg.includes('=')));
    assert.ok(!invocation.args.includes('-e'));
    const commandText = ghosttyArgs[1].slice('--initial-command=shell:'.length);
    const parsed = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `set -- ${commandText}; printf '%s\\0' "$@"`]).toString().split('\0').slice(0, -1);
    const [shell, flags, ...args] = parsed;
    assert.equal(flags, '-ilc');
    // Run the actual wrapper without loading the developer's personal shell startup files.
    execFileSync(shell, ['-fc', ...args]);
    assert.equal(await realpath((await readFile(join(path, 'result.txt'), 'utf8')).trim()), await realpath(path));
    const calls = [];
    assert.deepEqual(await runInTerminal('ghostty', path, 'pnpm dev', { execute: async (...input) => calls.push(input) }), { terminalName: 'Ghostty' });
    assert.equal(calls.length, 1);
    await assert.rejects(runInTerminal('ghostty', path, 'pnpm dev', { execute: async () => { throw new Error('not installed'); } }), /无法打开 Ghostty/);
    await assert.rejects(runInTerminal('terminal', join(path, 'missing'), 'pnpm dev'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
