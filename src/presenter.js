import * as theme from './theme.js';

function relativeTime(value) {
  if (!value) return '暂无提交';
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function characterWidth(character) {
  const code = character.codePointAt(0);
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (
    (code >= 0x300 && code <= 0x36f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0xfe00 && code <= 0xfe0f)
    || (code >= 0xfe20 && code <= 0xfe2f)
    || code === 0x200d
  ) return 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f
      || code === 0x2329
      || code === 0x232a
      || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe19)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff)
      || (code >= 0x20000 && code <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

export function displayWidth(value) {
  return [...theme.stripAnsi(value)].reduce((width, character) => width + characterWidth(character), 0);
}

export function fitColumn(value, width) {
  const source = String(value ?? '');
  if (displayWidth(source) <= width) return `${source}${' '.repeat(width - displayWidth(source))}`;
  let result = '';
  let used = 0;
  const contentWidth = Math.max(0, width - 1);
  for (const character of source) {
    const nextWidth = characterWidth(character);
    if (used + nextWidth > contentWidth) break;
    result += character;
    used += nextWidth;
  }
  return `${result}…${' '.repeat(Math.max(0, width - used - 1))}`;
}

export function formatRepositoryMenuLabel(repository, status) {
  return `${theme.repositoryName(fitColumn(repository.name, 16))}  ${theme.status(fitColumn(statusLabel(status), 20), status)}`.trimEnd();
}

export function statusLabel(status) {
  if (status.kind === 'error') return `无法读取：${status.error}`;
  if (status.kind === 'non_git') return '未初始化 Git';
  const parts = [];
  if (status.dirty) parts.push(`未提交 ${status.changes.length}`);
  if (status.ahead > 0) parts.push(`未推送 ${status.ahead}`);
  if (status.behind > 0) parts.push(`落后 ${status.behind}`);
  if (!status.upstream) parts.push('未设置 upstream');
  if (status.detached) parts.push('detached HEAD');
  if (status.operation) parts.push(status.operation);
  return parts.length ? parts.join(' · ') : '已同步';
}

export function unpushedSummary(status) {
  const commits = status.unpushedCommits || [];
  if (!commits.length) return '未读取到提交摘要';
  const remaining = commits.length - 1;
  return `${commits[0].subject}${remaining > 0 ? ` · 另有 ${remaining} 条` : ''}`;
}

export function printProjectList(entries, output = console.log, { showIndex = false } = {}) {
  if (!entries.length) {
    output('还没有项目。');
    return;
  }
  for (const entry of entries) {
    output(`\n${theme.projectName(entry.project.name)}${entry.project.workspacePath ? `  ${theme.muted(entry.project.workspacePath)}` : ''}`);
    if (!entry.repositories.length) output(theme.muted('  暂无代码库'));
    else output(theme.muted(`  ${showIndex ? `${fitColumn('#', 3)}  ` : ''}${fitColumn('代码库', 16)}  ${fitColumn('当前分支', 24)}  ${fitColumn('状态', 20)}  ${fitColumn('最后提交', 12)}  提交内容`));
    for (const [index, item] of entry.repositories.entries()) {
      const last = item.status.lastCommit;
      const commitTime = last ? relativeTime(last.authoredAt) : '-';
      const subject = last?.subject || '暂无提交';
      const number = showIndex ? `${theme.count(fitColumn(index + 1, 3))}  ` : '';
      output(`  ${number}${theme.repositoryName(fitColumn(item.repository.name, 16))}  ${theme.branch(fitColumn(item.status.branch || '-', 24))}  ${theme.status(fitColumn(statusLabel(item.status), 20), item.status)}  ${theme.muted(fitColumn(commitTime, 12))}  ${subject}`);
    }
  }
}

export function printOpenerList(openers, defaultOpenerId, output = console.log) {
  if (!openers.length) {
    output('还没有打开工具。');
    return;
  }
  output(`${fitColumn('#', 3)}  ${fitColumn('名称', 24)}  ${fitColumn('id', 24)}  状态`);
  for (const [index, opener] of openers.entries()) {
    const states = [];
    if (opener.id === defaultOpenerId) states.push('默认');
    if (opener.mode === 'terminal') states.push('Terminal');
    output(`${theme.count(fitColumn(index + 1, 3))}  ${theme.action(fitColumn(opener.name, 24))}  ${theme.muted(fitColumn(opener.id, 24))}  ${theme.muted(states.join(' · ') || '-')}`);
  }
}

export function printInspect(project, repository, status, output = console.log) {
  output(`${theme.projectName(project.name)} / ${theme.repositoryName(repository.name)}`);
  output(`${theme.muted('路径')}       ${theme.muted(repository.path)}`);
  if (status.kind === 'non_git') {
    output(`${theme.muted('Git')}        ${theme.status('未初始化 Git', status)}`);
    return;
  }
  output(`${theme.muted('分支')}       ${theme.branch(status.branch || '-')}`);
  output(`${theme.muted('上游')}       ${theme.branch(status.upstream || '未设置')}`);
  output(`${theme.muted('状态')}       ${theme.status(statusLabel(status), status)}`);
  if (status.lastCommit) output(`${theme.muted('最后提交')}   ${theme.muted(status.lastCommit.hash)}  ${theme.muted(relativeTime(status.lastCommit.authoredAt))}  ${status.lastCommit.subject}`);
  if (status.changes.length) {
    output(`\n${theme.failure('未提交修改')}`);
    for (const change of status.changes) output(`  ${change.code.padEnd(3)} ${change.path}`);
  }
  if (status.unpushedCommits.length) {
    output(`\n${theme.status('未推送提交', { kind: 'git', ahead: 1 })}`);
    for (const commit of status.unpushedCommits) output(`  ${theme.muted(commit.hash)}  ${commit.subject}`);
  }
}
