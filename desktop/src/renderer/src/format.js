export function statusText(status) {
  if (!status) return '正在获取…';
  if (status.kind === 'error') return `Git 状态读取失败：${status.error}`;
  if (status.kind === 'non_git') return '当前目录尚未初始化 Git';
  const parts = [];
  if (status.behind > 0) parts.push(`落后远端 ${status.behind} 个提交`);
  if (status.dirty) parts.push(`${status.changes.length} 个文件修改未提交`);
  if (status.ahead > 0) parts.push(`${status.ahead} 个提交未推送`);
  if (!status.upstream) parts.push('当前分支未设置上游分支');
  if (status.detached) parts.push('当前处于 detached HEAD 状态');
  if (status.operation) parts.push(`当前正在进行 ${status.operation}`);
  return parts.join(' · ') || '本地与远端状态已同步';
}

export function statusTone(status) {
  if (!status) return 'loading';
  if (status.kind === 'error' || status.detached || status.operation || status.behind > 0 || status.dirty) return 'danger';
  if (status.kind === 'non_git' || !status.upstream || status.ahead > 0) return 'warning';
  return 'success';
}

export function pushEligibility(status) {
  if (!status || status.kind !== 'git') return { eligible: false, reason: status ? '未初始化 Git' : '正在获取 Git 状态' };
  if (status.detached) return { eligible: false, reason: 'detached HEAD' };
  if (status.operation) return { eligible: false, reason: `正在进行 ${status.operation}` };
  if (!status.upstream) return { eligible: false, reason: '未设置 upstream' };
  if (status.ahead <= 0) return { eligible: false, reason: '没有未推送提交' };
  if (status.behind > 0) return { eligible: false, reason: `落后远端 ${status.behind} 个提交` };
  return { eligible: true, reason: null };
}

export function pullEligibility(status) {
  if (!status || status.kind !== 'git') return { eligible: false, reason: status ? '未初始化 Git' : '正在获取 Git 状态' };
  if (status.detached) return { eligible: false, reason: 'detached HEAD' };
  if (status.operation) return { eligible: false, reason: `正在进行 ${status.operation}` };
  if (!status.upstream) return { eligible: false, reason: '未设置 upstream' };
  if (status.dirty) return { eligible: false, reason: '存在未提交文件' };
  if (status.ahead > 0) return { eligible: false, reason: `有 ${status.ahead} 个提交未推送` };
  if (status.behind <= 0) return { eligible: false, reason: '没有需要拉取的提交' };
  return { eligible: true, reason: null };
}

export function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function middleEllipsis(value, maxLength = 72) {
  const characters = Array.from(String(value ?? ''));
  if (characters.length <= maxLength) return characters.join('');
  if (maxLength <= 1) return '…';
  const visibleLength = maxLength - 1;
  const endLength = Math.ceil(visibleLength * 0.6);
  const startLength = visibleLength - endLength;
  return `${characters.slice(0, startLength).join('')}…${characters.slice(-endLength).join('')}`;
}

export function openerKind(opener) {
  if (opener.mode === 'terminal') return '终端命令';
  if (opener.command === 'open' && opener.args?.length === 3 && opener.args[0] === '-a' && opener.args[2] === '{path}') return 'macOS 应用';
  return '后台命令';
}
