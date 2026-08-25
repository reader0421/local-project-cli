import test from 'node:test';
import assert from 'node:assert/strict';
import * as theme from '../src/theme.js';

test('colors are enabled only for an interactive terminal and respect NO_COLOR', () => {
  assert.equal(theme.colorEnabled({}, { isTTY: true }), true);
  assert.equal(theme.colorEnabled({}, { isTTY: false }), false);
  assert.equal(theme.colorEnabled({ NO_COLOR: '' }, { isTTY: true }), false);
  assert.equal(theme.colorEnabled({ TERM: 'dumb' }, { isTTY: true }), false);
});

test('semantic colors distinguish counts and repository states', () => {
  assert.match(theme.count(2, true), /\x1b\[33m/);
  assert.match(theme.status('已同步', {
    kind: 'git', upstream: 'origin/main', ahead: 0, behind: 0, dirty: false,
  }, true), /\x1b\[32m/);
  assert.match(theme.status('未提交 1', {
    kind: 'git', upstream: 'origin/main', ahead: 0, behind: 0, dirty: true,
  }, true), /\x1b\[31m/);
  assert.match(theme.status('未推送 1', {
    kind: 'git', upstream: 'origin/main', ahead: 1, behind: 0, dirty: false,
  }, true), /\x1b\[33m/);
  assert.equal(theme.stripAnsi(theme.count(2, true)), '2');
});
