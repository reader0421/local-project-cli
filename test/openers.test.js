import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRegistry } from '../src/constants.js';
import {
  addOpener,
  buildOpenCommand,
  isMacOSApplicationOpener,
  macOSApplicationOpener,
  removeOpener,
  resolveOpener,
  setDefaultOpener,
  updateOpener,
} from '../src/openers.js';

test('repository explicit default opener wins and custom application paths can be configured', () => {
  const registry = createEmptyRegistry();
  registry.openers.push({
    id: 'custom-ide-local',
    name: 'Custom IDE',
    command: 'open',
    args: ['-a', '/Applications/Custom IDE.app', '{path}'],
  });
  registry.settings.defaultOpenerId = 'phpstorm';
  const project = { defaultOpenerId: 'xcode' };
  const repository = { defaultOpenerId: 'custom-ide-local' };
  const opener = resolveOpener(registry, project, repository);
  assert.equal(opener.id, 'custom-ide-local');
  assert.deepEqual(buildOpenCommand(opener, '/tmp/example-app').args, ['-a', '/Applications/Custom IDE.app', '/tmp/example-app']);

  delete repository.defaultOpenerId;
  assert.equal(resolveOpener(registry, project, repository).id, 'phpstorm');
});

test('custom openers can be added, updated, selected as default and removed safely', () => {
  const registry = createEmptyRegistry();
  const opener = addOpener(registry, {
    id: 'zed-preview',
    name: 'Zed Preview',
    command: 'open',
    args: ['-a', 'Zed Preview', '{path}'],
  });
  assert.equal(opener.id, 'zed-preview');

  updateOpener(registry, opener.id, {
    name: 'Zed',
    args: ['-a', 'Zed', '{path}'],
  });
  assert.equal(opener.name, 'Zed');
  assert.deepEqual(opener.args, ['-a', 'Zed', '{path}']);

  setDefaultOpener(registry, opener.id);
  assert.throws(() => removeOpener(registry, opener.id), /不能删除默认打开工具/);
  setDefaultOpener(registry, 'vscode');
  assert.equal(removeOpener(registry, opener.id), opener);
  assert.equal(registry.openers.some((item) => item.id === opener.id), false);
});

test('an opener configured as a repository default cannot be removed', () => {
  const registry = createEmptyRegistry();
  addOpener(registry, { id: 'zed', name: 'Zed', command: 'zed', args: ['{path}'] });
  registry.projects.push({
    id: 'demo',
    name: 'Demo',
    slug: 'demo',
    repositories: [{ id: 'app', name: 'app', slug: 'app', path: '/tmp/app', defaultOpenerId: 'zed' }],
  });
  assert.throws(() => removeOpener(registry, 'zed'), /Demo\/app/);
});

test('macOS application openers only require an app name or path', () => {
  const definition = macOSApplicationOpener('/Applications/Custom IDE.app');
  assert.deepEqual(definition, {
    command: 'open',
    args: ['-a', '/Applications/Custom IDE.app', '{path}'],
  });
  assert.equal(isMacOSApplicationOpener(definition), true);
  assert.equal(isMacOSApplicationOpener({ command: 'zed', args: ['{path}'] }), false);
});

test('terminal openers launch interactive commands through Terminal without interpolating paths into AppleScript', () => {
  const path = "/tmp/project with 'quotes'";
  const invocation = buildOpenCommand({
    id: 'codex-cli',
    name: 'Codex CLI',
    command: 'codex',
    args: ['-C', '{path}'],
    mode: 'terminal',
  }, path);
  assert.equal(invocation.command, '/usr/bin/osascript');
  assert.deepEqual(invocation.args.slice(-4), ['--', 'codex', '-C', path]);
  assert.equal(invocation.args.slice(0, -4).some((arg) => arg.includes(path)), false);
  assert.equal(invocation.displayCommand, 'codex');
  assert.deepEqual(invocation.displayArgs, ['-C', path]);
});
