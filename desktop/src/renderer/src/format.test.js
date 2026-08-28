import { describe, expect, it } from 'vitest';
import { middleEllipsis, openerKind, pullEligibility, pushEligibility, statusText, statusTone } from './format.js';

describe('Git status presentation', () => {
  it('keeps dirty repositories pushable when commits are safely ahead', () => {
    const status = {
      kind: 'git',
      dirty: true,
      changes: [{ path: 'README.md' }],
      ahead: 2,
      behind: 0,
      upstream: 'origin/main',
      detached: false,
      operation: null,
    };
    expect(statusText(status)).toBe('1 个文件修改未提交 · 2 个提交未推送');
    expect(statusText({ ...status, behind: 7 })).toBe('落后远端 7 个提交 · 1 个文件修改未提交 · 2 个提交未推送');
    expect(statusTone(status)).toBe('danger');
    expect(pushEligibility(status)).toEqual({ eligible: true, reason: null });
  });

  it('uses one semantic color scheme for dirty, unpushed and normal repositories', () => {
    const base = { kind: 'git', dirty: false, changes: [], ahead: 0, behind: 0, upstream: 'origin/main', detached: false, operation: null };
    expect(statusTone({ ...base, dirty: true, changes: [{ path: 'README.md' }] })).toBe('danger');
    expect(statusTone({ ...base, ahead: 2 })).toBe('warning');
    expect(statusTone(base)).toBe('success');
  });

  it('explains every unsafe push state', () => {
    expect(pushEligibility({ kind: 'non_git' }).reason).toBe('未初始化 Git');
    expect(pushEligibility({ kind: 'git', detached: true }).reason).toBe('detached HEAD');
    expect(pushEligibility({ kind: 'git', operation: 'rebase' }).reason).toBe('正在进行 rebase');
    expect(pushEligibility({ kind: 'git', upstream: null }).reason).toBe('未设置 upstream');
    expect(pushEligibility({ kind: 'git', upstream: 'origin/main', ahead: 0 }).reason).toBe('没有未推送提交');
    expect(pushEligibility({ kind: 'git', upstream: 'origin/main', ahead: 1, behind: 2 }).reason).toBe('落后远端 2 个提交');
  });

  it('only allows a clean strictly-behind branch to pull safely', () => {
    const safe = { kind: 'git', upstream: 'origin/main', dirty: false, ahead: 0, behind: 2, detached: false, operation: null };
    expect(pullEligibility(safe)).toEqual({ eligible: true, reason: null });
    expect(pullEligibility({ ...safe, dirty: true }).reason).toBe('存在未提交文件');
    expect(pullEligibility({ ...safe, ahead: 1 }).reason).toBe('有 1 个提交未推送');
    expect(pullEligibility({ ...safe, behind: 0 }).reason).toBe('没有需要拉取的提交');
  });
});

describe('opener kinds', () => {
  it('distinguishes macOS apps, background commands and terminal commands', () => {
    expect(openerKind({ command: 'open', args: ['-a', 'Xcode', '{path}'] })).toBe('macOS 应用');
    expect(openerKind({ command: 'code', args: ['{path}'] })).toBe('后台命令');
    expect(openerKind({ command: 'codex', args: ['-C', '{path}'], mode: 'terminal' })).toBe('终端命令');
  });
});

describe('long text middle ellipsis', () => {
  it('keeps the path start and filename end, including Chinese characters', () => {
    const path = 'app/src/main/java/com/weimoka/moka/功能模块/registration/TonggaoRegistrationService.java';
    const compact = middleEllipsis(path, 40);

    expect(Array.from(compact)).toHaveLength(40);
    expect(compact).toMatch(/^app\/src\/main/);
    expect(compact).toMatch(/RegistrationService\.java$/);
    expect(compact).toContain('…');
  });

  it('leaves a short path unchanged', () => {
    expect(middleEllipsis('app/build.gradle')).toBe('app/build.gradle');
  });
});
