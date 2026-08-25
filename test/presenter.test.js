import test from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, fitColumn, formatRepositoryMenuLabel, printOpenerList, printProjectList, unpushedSummary } from '../src/presenter.js';
import * as theme from '../src/theme.js';

test('fixed columns use terminal display width for Chinese and ASCII', () => {
  assert.equal(displayWidth('后台'), 4);
  assert.equal(displayWidth('android'), 7);
  assert.equal(displayWidth(fitColumn('后台', 10)), 10);
  assert.equal(displayWidth(fitColumn('android', 10)), 10);
  assert.equal(displayWidth(fitColumn('非常长的代码库名称', 10)), 10);
  assert.equal(displayWidth(theme.repositoryName(fitColumn('后台', 10), true)), 10);
});

test('project repository rows and menu labels keep fixed column offsets', () => {
  const lines = [];
  const synced = { kind: 'git', branch: 'dev', upstream: 'origin/dev', ahead: 0, behind: 0, dirty: false, detached: false, operation: null, lastCommit: null };
  printProjectList([{
    project: { name: '示例项目', repositories: [] },
    repositories: [
      { repository: { name: '后台' }, status: synced },
      { repository: { name: 'android' }, status: { ...synced, dirty: true, changes: [{ path: 'a' }] } },
    ],
  }], (line) => lines.push(line));
  const header = lines[1];
  const chineseRow = lines[2];
  const asciiRow = lines[3];
  const branchOffset = displayWidth(header.slice(0, header.indexOf('当前分支')));
  assert.equal(displayWidth(chineseRow.slice(0, chineseRow.indexOf('dev'))), branchOffset);
  assert.equal(displayWidth(asciiRow.slice(0, asciiRow.indexOf('dev'))), branchOffset);
  const chineseMenu = formatRepositoryMenuLabel({ name: '后台' }, synced);
  const asciiMenu = formatRepositoryMenuLabel({ name: 'android' }, synced);
  assert.equal(displayWidth(chineseMenu.slice(0, chineseMenu.indexOf('已同步'))), 18);
  assert.equal(displayWidth(asciiMenu.slice(0, asciiMenu.indexOf('已同步'))), 18);
});

test('interactive repository table includes a fixed-width numeric selection column', () => {
  const lines = [];
  const synced = { kind: 'git', branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, dirty: false, detached: false, operation: null, lastCommit: null };
  printProjectList([{
    project: { name: 'Demo', repositories: [] },
    repositories: [{ repository: { name: '后台' }, status: synced }],
  }], (line) => lines.push(line), { showIndex: true });
  assert.match(lines[1], /#\s+代码库/);
  assert.match(lines[2], /^\s+1\s+后台/);
  assert.equal(displayWidth(lines[1].slice(0, lines[1].indexOf('代码库'))), displayWidth(lines[2].slice(0, lines[2].indexOf('后台'))));
});

test('opener table keeps Chinese and ASCII names aligned and contains data rows only', () => {
  const lines = [];
  printOpenerList([
    { id: 'wechat-devtools', name: '微信开发者工具', command: 'open', args: ['-a', '微信开发者工具', '{path}'] },
    { id: 'codex-cli', name: 'Codex CLI', command: 'codex', args: ['-C', '{path}'], mode: 'terminal' },
  ], 'wechat-devtools', (line) => lines.push(line));

  assert.equal(lines.length, 3);
  assert.match(lines[0], /^#\s+名称\s+id\s+状态$/);
  assert.match(lines[1], /^1\s+微信开发者工具\s+wechat-devtools\s+默认$/);
  assert.match(lines[2], /^2\s+Codex CLI\s+codex-cli\s+Terminal$/);
  const idOffset = displayWidth(lines[0].slice(0, lines[0].indexOf('id')));
  assert.equal(displayWidth(lines[1].slice(0, lines[1].indexOf('wechat-devtools'))), idOffset);
  assert.equal(displayWidth(lines[2].slice(0, lines[2].indexOf('codex-cli'))), idOffset);
  assert.doesNotMatch(lines.join('\n'), /新增|返回/);
});

test('unpushed summary shows the newest subject and remaining commit count', () => {
  assert.equal(unpushedSummary({ unpushedCommits: [{ subject: '修复登录' }] }), '修复登录');
  assert.equal(unpushedSummary({ unpushedCommits: [
    { subject: '修复登录' },
    { subject: '补充测试' },
    { subject: '更新文档' },
  ] }), '修复登录 · 另有 2 条');
  assert.equal(unpushedSummary({ unpushedCommits: [] }), '未读取到提交摘要');
});
