import test from 'node:test';
import assert from 'node:assert/strict';
import { commandIdentifier, matchListInput } from '../src/prompts.js';
import { parseOpenerArguments } from '../src/cli.js';

const commands = [
  { key: 'add', aliases: ['a'], value: 'add-repo' },
  { key: 'remove', aliases: ['r', 'd'], value: 'remove-project' },
  { key: 'back', aliases: ['b'], value: 'back' },
];

test('list numbers select data while stable words and aliases select commands', () => {
  const repositories = ['repo-one', 'repo-two'];
  assert.deepEqual(matchListInput('2', repositories, commands), { value: 'repo-two' });
  assert.deepEqual(matchListInput('add', repositories, commands), { value: 'add-repo' });
  assert.deepEqual(matchListInput(' A ', repositories, commands), { value: 'add-repo' });
  assert.deepEqual(matchListInput('d', repositories, commands), { value: 'remove-project' });
  assert.deepEqual(matchListInput('back', repositories, commands), { value: 'back' });
  assert.equal(matchListInput('3', repositories, commands), null);
});

test('command matching does not depend on list length', () => {
  assert.deepEqual(matchListInput('back', [], commands), { value: 'back' });
  assert.deepEqual(matchListInput('back', ['one', 'two', 'three'], commands), { value: 'back' });
});

test('opener list numbers select openers while add and back remain fixed operations', () => {
  const openerCommands = [
    { key: 'add', aliases: ['a'], value: '__add__' },
    { key: 'back', aliases: ['b'], value: '__back__' },
  ];
  const openers = ['vscode', 'android-studio', 'chatgpt'];

  assert.deepEqual(matchListInput('3', openers, openerCommands), { value: 'chatgpt' });
  assert.deepEqual(matchListInput('add', openers, openerCommands), { value: '__add__' });
  assert.deepEqual(matchListInput('a', ['vscode'], openerCommands), { value: '__add__' });
  assert.deepEqual(matchListInput('back', openers, openerCommands), { value: '__back__' });
  assert.deepEqual(matchListInput('b', [], openerCommands), { value: '__back__' });
  assert.equal(matchListInput('4', openers, openerCommands), null);
});

test('command labels expose their accepted shortcuts', () => {
  assert.equal(commandIdentifier(commands[0]), 'add (a)');
  assert.equal(commandIdentifier(commands[1]), 'remove (r/d)');
  assert.equal(commandIdentifier({ key: 'save', value: 'save' }), 'save');
});

test('interactive opener arguments use an explicit JSON string array', () => {
  assert.deepEqual(parseOpenerArguments('["-a", "Custom IDE", "{path}"]'), ['-a', 'Custom IDE', '{path}']);
  assert.throws(() => parseOpenerArguments('Custom IDE {path}'), /JSON 数组/);
  assert.throws(() => parseOpenerArguments('[]'), /至少包含一个字符串/);
  assert.throws(() => parseOpenerArguments('["{path}", 1]'), /至少包含一个字符串/);
});
