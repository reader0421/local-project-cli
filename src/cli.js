import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  addProject,
  addRepository,
  findProject,
  findRepository,
  loadRegistry,
  removeProject,
  removeRepository,
  resolveRegistryPath,
  saveRegistry,
} from './registry.js';
import { getGitStatus, getPushEligibility, pushRepository } from './git.js';
import {
  addOpener,
  findOpener,
  isMacOSApplicationOpener,
  macOSApplicationOpener,
  openPath,
  openerMode,
  removeOpener,
  resolveOpener,
  setDefaultOpener,
  updateOpener,
} from './openers.js';
import { createPrompter, ExitRequested } from './prompts.js';
import { fitColumn, printInspect, printOpenerList, printProjectList, statusLabel, unpushedSummary } from './presenter.js';
import { scanRegistry } from './scanner.js';
import * as theme from './theme.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json');

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  const valueOptions = new Set(['registry', 'project', 'name', 'workspace', 'opener', 'open-target', 'with', 'id', 'command', 'mode']);
  const repeatable = new Set(['arg']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const separator = token.indexOf('=');
    const key = token.slice(2, separator === -1 ? undefined : separator);
    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    if (valueOptions.has(key) || repeatable.has(key)) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
        throw new Error(`--${key} 需要参数；以 -- 开头的值请使用 --${key}=<值>`);
      }
      if (inlineValue === undefined) index += 1;
      if (repeatable.has(key)) (options[key] ||= []).push(value);
      else options[key] = value;
    } else {
      if (inlineValue !== undefined) throw new Error(`--${key} 不接受参数`);
      options[key] = true;
    }
  }
  return { positionals, options };
}

function flatten(entries) {
  return entries.flatMap((entry) => entry.repositories.map((item) => ({ project: entry.project, ...item })));
}

function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

async function scanRegistryWithFeedback(registry, title, options = {}) {
  clearScreen();
  console.log(`${theme.title(title)}\n`);
  let lastProgress = '';
  const entries = await scanRegistry(registry, {
    ...options,
    onProgress({ completed, total }) {
      const progress = total ? `正在读取 Git 状态 ${completed}/${total}…` : '没有需要读取的代码库。';
      if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${theme.muted(progress)}`);
      else if (progress !== lastProgress) console.log(progress);
      lastProgress = progress;
    },
  });
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
  return entries;
}

async function getGitStatusWithFeedback(project, repository) {
  clearScreen();
  console.log(`${theme.title(`${project.name} / ${repository.name}`)}\n`);
  console.log(theme.muted('正在读取 Git 状态…'));
  return getGitStatus(repository.path);
}

async function chooseProject(registry, prompter) {
  const createValue = '__create__';
  const selected = await prompter.select('选择项目', [
    ...registry.projects.map((project) => ({ label: theme.projectName(project.name), value: project.id })),
    { label: theme.action('＋ 创建新项目'), value: createValue },
  ]);
  if (selected !== createValue) return findProject(registry, selected);
  const name = await prompter.text('项目名称');
  return addProject(registry, { name });
}

async function interactiveAdd(registry, registryPath, prompter) {
  clearScreen();
  const kind = await prompter.select('添加内容', [
    { label: theme.action('项目'), value: 'project' },
    { label: theme.action('代码库'), value: 'repo' },
    { label: theme.muted('返回首页'), value: 'back' },
  ]);
  if (kind === 'back') return;
  if (kind === 'project') {
    const name = await prompter.text('项目名称');
    const project = addProject(registry, { name });
    await saveRegistry(registryPath, registry);
    console.log(`已添加项目：${project.name}`);
    await prompter.pause('按 Enter 返回首页');
    return;
  }
  const project = await chooseProject(registry, prompter);
  await interactiveAddRepository(registry, registryPath, project, prompter);
  await prompter.pause('按 Enter 返回首页');
}

async function interactiveAddRepository(registry, registryPath, project, prompter) {
  const path = await prompter.text('代码库文件夹', process.cwd());
  const name = await prompter.text('代码库名称', basename(resolve(path)));
  const repository = await addRepository(registry, project, { name, path });
  await saveRegistry(registryPath, registry);
  console.log(`已添加：${project.name}/${repository.name}`);
  return repository;
}

async function interactiveHome(registry, registryPath) {
  const prompter = createPrompter();
  let entries = null;
  try {
    while (true) {
      try {
        entries ||= await scanRegistryWithFeedback(registry, 'Local Project CLI');
        const unpushed = flatten(entries).filter((item) => item.status.kind === 'git' && item.status.ahead > 0).length;
        clearScreen();
        console.log(`${theme.title('Local Project CLI')}\n`);
        const action = await prompter.select('请选择', [
          { label: `${theme.action('未推送')} ${theme.count(unpushed)}`, value: 'pending' },
          { label: `${theme.action('项目列表')} ${theme.count(registry.projects.length)}`, value: 'list' },
          { label: theme.action('添加项目或代码库'), value: 'add' },
          { label: theme.action('设置'), value: 'settings' },
          { label: theme.muted('退出'), value: 'exit' },
        ]);
        if (action === 'exit') return;
        if (action === 'pending') {
          await interactivePending(registry, registryPath, prompter, entries);
          entries = null;
        } else if (action === 'list') {
          await interactiveProjectList(registry, registryPath, prompter, entries);
          entries = null;
        } else if (action === 'add') {
          await interactiveAdd(registry, registryPath, prompter);
          entries = null;
        } else {
          await interactiveSettings(registry, registryPath, prompter);
        }
      } catch (error) {
        if (error instanceof ExitRequested || error.code === 'ABORT_ERR') return;
        console.log(`\n操作失败：${error.message}`);
        await prompter.pause('按 Enter 返回首页');
      }
    }
  } finally {
    prompter.close();
  }
}

async function interactiveSettings(registry, registryPath, prompter) {
  let notice = null;
  while (true) {
    clearScreen();
    const defaultOpener = resolveOpener(registry, null, null);
    if (notice) console.log(`${theme.success('✓')} ${notice}\n`);
    notice = null;
    console.log(`${theme.title('设置')}\n`);
    console.log(`${theme.muted('注册表')}          ${theme.muted(registryPath)}`);
    console.log(`${theme.muted('默认打开工具')}    ${defaultOpener.name} ${theme.muted(defaultOpener.id)}`);
    const action = await prompter.select('\n设置项', [
      { label: theme.action('修改默认打开工具'), value: 'default-opener' },
      { label: theme.action('管理打开工具'), value: 'manage-openers' },
      { label: theme.muted('返回首页'), value: 'back' },
    ]);
    if (action === 'back') return;
    if (action === 'manage-openers') {
      await interactiveOpenerManager(registry, registryPath, prompter);
      continue;
    }
    const openerId = await prompter.select('选择全局默认打开工具', registry.openers.map((opener) => ({
      label: `${theme.action(opener.name)}  ${theme.muted(opener.id)}`,
      value: opener.id,
    })));
    registry.settings.defaultOpenerId = openerId;
    await saveRegistry(registryPath, registry);
    notice = `默认打开工具已修改为 ${resolveOpener(registry, null, null).name}`;
  }
}

export function parseOpenerArguments(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('参数必须是 JSON 数组，例如 ["-a", "Custom IDE", "{path}"]');
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('参数必须是至少包含一个字符串的 JSON 数组');
  }
  return parsed;
}

async function promptOpenerArguments(prompter, current = ['{path}']) {
  while (true) {
    const value = await prompter.text('参数 JSON 数组（{path} 会替换为代码库路径）', JSON.stringify(current));
    try {
      return parseOpenerArguments(value);
    } catch (error) {
      console.log(`${theme.failure('格式错误')}：${error.message}`);
    }
  }
}

async function promptOpenerDefinition(prompter, current = null) {
  const name = await prompter.text('显示名称', current?.name || '');
  const currentIsApplication = isMacOSApplicationOpener(current);
  const kind = await prompter.select('启动方式', [
    { label: theme.action('macOS 应用（使用 open -a，只需应用名称或 .app 路径）'), value: 'macos-app' },
    { label: theme.action('后台命令（完整设置 command 和 args，不需要终端交互）'), value: 'background' },
    { label: theme.action('终端命令（在 Terminal 中交互运行）'), value: 'terminal' },
  ]);
  if (kind === 'macos-app') {
    const application = await prompter.text(
      '应用名称或 .app 完整路径',
      currentIsApplication ? current.args[1] : '',
    );
    return { name, ...macOSApplicationOpener(application), mode: 'background' };
  }
  const command = await prompter.text('可执行命令', current?.command || '');
  const args = await promptOpenerArguments(prompter, current?.args || ['{path}']);
  return { name, command, args, mode: kind === 'terminal' ? 'terminal' : 'background' };
}

async function interactiveOpenerManager(registry, registryPath, prompter) {
  let notice = null;
  while (true) {
    clearScreen();
    console.log(`${theme.title('打开工具')}\n`);
    if (notice) console.log(`${notice.kind === 'error' ? theme.failure('!') : theme.success('✓')} ${notice.message}\n`);
    notice = null;
    printOpenerList(registry.openers, registry.settings.defaultOpenerId);
    const selected = await prompter.selectList('\n操作', registry.openers.map((opener) => opener.id), [
      { key: 'add', aliases: ['a'], label: theme.action('新增打开工具'), value: '__add__' },
      { key: 'back', aliases: ['b'], label: theme.muted('返回设置'), value: '__back__' },
    ]);
    if (selected === '__back__') return;
    if (selected === '__add__') {
      try {
        const id = await prompter.text('稳定 id（字母、数字、点、下划线或连字符）');
        const definition = await promptOpenerDefinition(prompter);
        const opener = addOpener(registry, { id, ...definition });
        await saveRegistry(registryPath, registry);
        notice = { kind: 'success', message: `已添加 ${opener.name}` };
      } catch (error) {
        notice = { kind: 'error', message: error.message };
      }
      continue;
    }
    const result = await interactiveOpenerDetails(registry, registryPath, findOpener(registry, selected), prompter);
    if (result) notice = result;
  }
}

async function interactiveOpenerDetails(registry, registryPath, opener, prompter) {
  while (true) {
    clearScreen();
    console.log(`${theme.title(opener.name)}  ${theme.muted(opener.id)}\n`);
    console.log(`${theme.muted('命令')}    ${opener.command}`);
    console.log(`${theme.muted('参数')}    ${JSON.stringify(opener.args)}`);
    console.log(`${theme.muted('模式')}    ${openerMode(opener) === 'terminal' ? 'Terminal 交互命令' : '后台启动'}`);
    console.log(`${theme.muted('默认')}    ${opener.id === registry.settings.defaultOpenerId ? '是' : '否'}`);
    const choices = [
      { label: theme.action('编辑'), value: 'edit' },
      ...(opener.id === registry.settings.defaultOpenerId ? [] : [{ label: theme.action('设为默认'), value: 'default' }]),
      { label: theme.destructive('删除'), value: 'remove' },
      { label: theme.muted('返回列表'), value: 'back' },
    ];
    const action = await prompter.select('\n操作', choices);
    if (action === 'back') return null;
    if (action === 'edit') {
      try {
        const definition = await promptOpenerDefinition(prompter, opener);
        updateOpener(registry, opener.id, definition);
        await saveRegistry(registryPath, registry);
        return { kind: 'success', message: `已更新 ${opener.name}` };
      } catch (error) {
        return { kind: 'error', message: error.message };
      }
    }
    if (action === 'default') {
      setDefaultOpener(registry, opener.id);
      await saveRegistry(registryPath, registry);
      return { kind: 'success', message: `默认打开工具已设置为 ${opener.name}` };
    }
    if (!await prompter.confirm(`从注册表删除打开工具 ${opener.name}`)) continue;
    try {
      removeOpener(registry, opener.id);
      await saveRegistry(registryPath, registry);
      return { kind: 'success', message: `已删除 ${opener.name}` };
    } catch (error) {
      return { kind: 'error', message: error.message };
    }
  }
}

async function copyPath(path) {
  await new Promise((done, reject) => {
    const child = spawn('pbcopy');
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? done() : reject(new Error(`pbcopy 退出码 ${code}`)));
    child.stdin.end(path);
  });
}

async function interactiveOpen(registry, registryPath, project, repository, prompter, chooseAnother = false) {
  let opener;
  if (chooseAnother) {
    const remembered = repository.lastOpenerId || registry.settings.defaultOpenerId;
    const choices = [...registry.openers]
      .sort((left, right) => Number(right.id === remembered) - Number(left.id === remembered))
      .map((item) => ({
        label: `${item.name}${item.id === remembered ? '（上次使用）' : ''}`,
        value: item.id,
      }));
    opener = resolveOpener(registry, project, repository, await prompter.select('选择打开工具', choices));
  } else {
    opener = resolveOpener(registry, project, repository);
  }
  await openPath(opener, repository.openTarget || repository.path);
  repository.lastOpenerId = opener.id;
  await saveRegistry(registryPath, registry);
  return opener;
}

async function interactiveRepositoryActions(registry, registryPath, project, repository, prompter) {
  let notice = null;
  while (findRepository(registry, repository.id)) {
    const status = await getGitStatusWithFeedback(project, repository);
    clearScreen();
    if (notice) console.log(`${notice.error ? theme.failure('✗') : theme.success('✓')} ${notice.message}\n`);
    notice = null;
    printInspect(project, repository, status);
    const eligibility = getPushEligibility(status);
    const defaultOpener = resolveOpener(registry, project, repository);
    const actions = [
      { key: 'open', aliases: ['o'], label: theme.action(`使用 ${defaultOpener.name} 打开`), value: 'open-default' },
      { key: 'with', aliases: ['w'], label: theme.action('选择其他工具打开'), value: 'open-other' },
      {
        key: 'push',
        aliases: ['p'],
        label: eligibility.eligible
          ? theme.status(`推送到 ${status.upstream}`, { kind: 'git', ahead: 1 })
          : theme.muted(`不可推送：${eligibility.reason}`),
        value: 'push',
      },
      { key: 'copy', aliases: ['c'], label: theme.action('复制文件夹路径'), value: 'copy' },
      { key: 'remove', aliases: ['r', 'd'], label: theme.destructive('从索引移除代码库'), value: 'remove' },
      { key: 'back', aliases: ['b'], label: theme.muted('返回上一页'), value: 'back' },
    ];
    const action = await prompter.selectList('\n操作', [], actions);
    if (action === 'back') return;
    try {
      if (action === 'open-default') {
        const opener = await interactiveOpen(registry, registryPath, project, repository, prompter);
        notice = { error: false, message: `已使用 ${opener.name} 打开 ${project.name}/${repository.name}` };
      } else if (action === 'open-other') {
        const opener = await interactiveOpen(registry, registryPath, project, repository, prompter, true);
        notice = { error: false, message: `已使用 ${opener.name} 打开 ${project.name}/${repository.name}` };
      } else if (action === 'copy') {
        await copyPath(repository.path);
        notice = { error: false, message: `已复制路径：${repository.path}` };
      } else if (action === 'remove') {
        if (!await prompter.confirm(`只移除 ${project.name}/${repository.name} 的索引，不删除磁盘文件。确认继续`)) continue;
        removeRepository(registry, repository.id);
        await saveRegistry(registryPath, registry);
        console.log('代码库索引已移除，磁盘文件未改动。');
        await prompter.pause('按 Enter 返回项目');
        return;
      } else if (action === 'push') {
        if (!eligibility.eligible) {
          notice = { error: true, message: `当前不可推送：${eligibility.reason}` };
          continue;
        }
        if (status.dirty) console.log('注意：当前仍有未提交修改，本次 Push 不包含这些修改。');
        if (!await prompter.confirm(`确认推送 ${status.ahead} 个提交到 ${status.upstream}`)) continue;
        await pushRepository(repository.path);
        notice = { error: false, message: `已推送 ${status.ahead} 个提交到 ${status.upstream}` };
      }
    } catch (error) {
      if (error instanceof ExitRequested || error.code === 'ABORT_ERR') throw error;
      notice = { error: true, message: `操作失败：${error.message}` };
    }
  }
}

async function interactiveProjectList(registry, registryPath, prompter, scannedEntries) {
  let entries = scannedEntries;
  let notice = null;
  while (true) {
    entries ||= await scanRegistryWithFeedback(registry, '项目列表');
    clearScreen();
    console.log(`${theme.title('项目列表')}\n`);
    if (notice) {
      console.log(`${theme.success('✓')} ${notice}\n`);
      notice = null;
    }
    if (entries.length) {
      console.log(theme.muted(`  ${fitColumn('#', 3)}  ${fitColumn('项目', 24)}  代码库`));
      entries.forEach((entry, index) => console.log(
        `  ${theme.count(fitColumn(index + 1, 3))}  ${theme.projectName(fitColumn(entry.project.name, 24))}  ${theme.count(entry.repositories.length)}`,
      ));
    } else {
      console.log(theme.muted('  还没有项目。'));
    }
    const selected = await prompter.selectList('\n操作', entries.map((entry) => entry.project.id), [
      { key: 'add', aliases: ['a'], label: theme.action('添加项目'), value: '__add__' },
      { key: 'back', aliases: ['b'], label: theme.muted('返回首页'), value: '__back__' },
    ]);
    if (selected === '__back__') return;
    if (selected === '__add__') {
      const name = await prompter.text('项目名称');
      const project = addProject(registry, { name });
      await saveRegistry(registryPath, registry);
      notice = `已添加项目：${project.name}`;
      entries = null;
      continue;
    }
    const selectedEntry = entries.find((entry) => entry.project.id === selected);
    await interactiveProjectDetails(registry, registryPath, findProject(registry, selected), prompter, selectedEntry);
    entries = null;
  }
}

async function interactiveProjectDetails(registry, registryPath, project, prompter, initialEntry = null) {
  let entry = initialEntry;
  while (findProject(registry, project.id)) {
    entry ||= (await scanRegistryWithFeedback(registry, project.name, { projects: [project] }))[0];
    clearScreen();
    printProjectList([entry], console.log, { showIndex: true });
    const action = await prompter.selectList('\n操作', entry.repositories.map((item) => `repo:${item.repository.id}`), [
      { key: 'add', aliases: ['a'], label: theme.action('添加代码库'), value: 'add-repo' },
      { key: 'remove', aliases: ['r', 'd'], label: theme.destructive('从索引移除项目'), value: 'remove-project' },
      { key: 'back', aliases: ['b'], label: theme.muted('返回项目列表'), value: 'back' },
    ]);
    if (action === 'back') return;
    if (action === 'add-repo') {
      clearScreen();
      console.log(`向 ${project.name} 添加代码库\n`);
      await interactiveAddRepository(registry, registryPath, project, prompter);
      await prompter.pause('按 Enter 返回项目');
      entry = null;
    } else if (action === 'remove-project') {
      if (!await prompter.confirm(`只移除 ${project.name} 及其 ${project.repositories.length} 个代码库索引，不删除磁盘文件。确认继续`)) continue;
      removeProject(registry, project.id);
      await saveRegistry(registryPath, registry);
      console.log('项目索引已移除，磁盘文件未改动。');
      await prompter.pause('按 Enter 返回项目列表');
      return;
    } else {
      const found = findRepository(registry, action.slice('repo:'.length));
      await interactiveRepositoryActions(registry, registryPath, found.project, found.repository, prompter);
      entry = null;
    }
  }
}

async function interactivePending(registry, registryPath, prompter, initialEntries = null) {
  let entries = initialEntries;
  while (true) {
    entries ||= await scanRegistryWithFeedback(registry, '未推送');
    const unpushed = flatten(entries).filter((item) => item.status.kind === 'git' && item.status.ahead > 0);
    clearScreen();
    console.log(`${theme.title('未推送')}\n`);
    if (!unpushed.length) {
      console.log(theme.muted('暂无未推送的代码库。'));
      await prompter.pause('按 Enter 返回首页');
      return;
    }
    console.log(theme.muted(`  ${fitColumn('#', 3)}  ${fitColumn('项目', 16)}  ${fitColumn('代码库', 16)}  ${fitColumn('分支', 20)}  ${fitColumn('状态', 20)}  未推送摘要`));
    unpushed.forEach((item, index) => console.log(
      `  ${theme.count(fitColumn(index + 1, 3))}  ${theme.projectName(fitColumn(item.project.name, 16))}  ${theme.repositoryName(fitColumn(item.repository.name, 16))}  ${theme.branch(fitColumn(item.status.branch, 20))}  ${theme.status(fitColumn(statusLabel(item.status), 20), item.status)}  ${unpushedSummary(item.status)}`,
    ));
    const action = await prompter.selectList('\n操作', unpushed.map((item) => item.repository.id), [
      { key: 'all', aliases: ['a'], label: theme.status('推送全部符合安全条件的代码库', { kind: 'git', ahead: 1 }), value: '__all__' },
      { key: 'back', aliases: ['b'], label: theme.muted('返回首页'), value: '__back__' },
    ]);
    if (action === '__back__') return;
    if (action === '__all__') await pushMany(registry, {}, entries, prompter);
    else {
      const found = findRepository(registry, action);
      await interactiveRepositoryActions(registry, registryPath, found.project, found.repository, prompter);
    }
    entries = null;
  }
}

async function showPending(registry, options, scannedEntries) {
  const entries = scannedEntries || await scanRegistry(registry, { fetch: options.fetch });
  const all = flatten(entries);
  const pushable = all.filter((item) => getPushEligibility(item.status).eligible);
  const attention = all.filter((item) => item.status.kind !== 'git' || item.status.dirty || item.status.behind > 0 || !item.status.upstream || item.status.detached || item.status.operation);
  if (options.json) {
    console.log(JSON.stringify({ pushable, attention }, null, 2));
    return;
  }
  console.log(`${theme.status('可以推送', { kind: 'git', ahead: 1 })} ${theme.count(pushable.length)}`);
  for (const item of pushable) console.log(`  ${theme.projectName(item.project.name)}/${theme.repositoryName(item.repository.name)}  ${theme.branch(item.status.branch)}  ${theme.status('未推送', item.status)} ${theme.count(item.status.ahead)}  ${unpushedSummary(item.status)}`);
  console.log(`\n${theme.failure('需要人工处理')} ${theme.count(attention.length)}`);
  for (const item of attention) console.log(`  ${theme.projectName(item.project.name)}/${theme.repositoryName(item.repository.name)}  ${theme.status(statusLabel(item.status), item.status)}`);
}

async function pushMany(registry, options, scannedEntries, existingPrompter) {
  const entries = scannedEntries || await scanRegistry(registry, { fetch: options.fetch });
  const all = flatten(entries);
  const planned = all.filter((item) => getPushEligibility(item.status).eligible);
  const skipped = all.filter((item) => item.status.kind === 'git' && item.status.ahead > 0 && !getPushEligibility(item.status).eligible);
  console.log(`${theme.status('将推送', { kind: 'git', ahead: 1 })} ${theme.count(planned.length)}`);
  for (const item of planned) console.log(`  ${item.project.name}/${item.repository.name}  ${item.status.ahead} commits → ${item.status.upstream}${item.status.dirty ? '（仍有未提交修改，不包含在 Push 中）' : ''}`);
  console.log(`\n${theme.failure('将跳过')} ${theme.count(skipped.length)}`);
  for (const item of skipped) console.log(`  ${item.project.name}/${item.repository.name}  ${getPushEligibility(item.status).reason}`);
  if (options['dry-run']) return;
  if (!options.yes) {
    const prompter = existingPrompter || createPrompter();
    try {
      if (!await prompter.confirm('确认执行以上 Push')) return;
    } finally { if (!existingPrompter) prompter.close(); }
  }
  for (const item of planned) {
    try {
      await pushRepository(item.repository.path);
      console.log(`✓ ${item.project.name}/${item.repository.name}`);
    } catch (error) {
      console.log(`✗ ${item.project.name}/${item.repository.name}：${error.message}`);
    }
  }
}

function help() {
  console.log(`Local Project CLI - 本地项目与代码库管理器

用法：
  project [--registry <file>]
  project add project [name] [--workspace <path>]
  project add repo [path] --project <name> [--name <name>]
  project add . --project <name> [--name <name>]
  project list [--fetch] [--json]
  project inspect <project/repo>
  project pending [--fetch] [--json]
  project push <project/repo> [--fetch] [--yes] [--dry-run]
  project push --all [--fetch] [--yes] [--dry-run]
  project open <project/repo> [--with <opener-id>] [--dry-run]
  project path <project/repo> [--copy]
  project remove project|repo <name>
  project opener list
  project opener get <id> [--json]
  project opener add --id <id> --name <name> --command <cmd> [--arg <arg> ...] [--mode background|terminal]
  project opener update <id> [--name <name>] [--command <cmd>] [--arg <arg> ...] [--mode background|terminal]
  project opener remove <id> [--yes]
  project opener default [id]

注册表优先级：--registry > LOCAL_PROJECT_CLI_REGISTRY > ~/.local-project-cli/registry.json`);
}

export async function run(argv) {
  if (argv.includes('--version') || argv.includes('-v')) return console.log(VERSION);
  if (argv.includes('-h')) return help();
  const { positionals, options } = parseArguments(argv);
  if (options.help || positionals[0] === 'help') return help();
  const registryPath = resolveRegistryPath(options.registry);
  const registry = await loadRegistry(registryPath);
  if (!positionals.length) return interactiveHome(registry, registryPath);
  const [command, subcommand, third] = positionals;

  if (command === 'add') {
    if (subcommand === 'project') {
      const prompter = createPrompter();
      try {
        const name = third || await prompter.text('项目名称');
        const project = addProject(registry, { name, workspacePath: options.workspace });
        await saveRegistry(registryPath, registry);
        console.log(`已添加项目：${project.name}`);
      } finally { prompter.close(); }
      return;
    }
    if (subcommand === 'repo' || subcommand === '.') {
      const path = subcommand === '.' ? '.' : (third || '.');
      const prompter = createPrompter();
      try {
        let project = options.project ? findProject(registry, options.project) : null;
        if (options.project && !project) throw new Error(`找不到项目：${options.project}`);
        if (!project) project = await chooseProject(registry, prompter);
        const name = options.name || await prompter.text('代码库名称', basename(resolve(path)));
        const repository = await addRepository(registry, project, { name, path, openerId: options.opener, openTarget: options['open-target'] });
        await saveRegistry(registryPath, registry);
        console.log(`已添加：${project.name}/${repository.name}${(await getGitStatus(repository.path)).kind === 'non_git' ? '（未初始化 Git）' : ''}`);
      } finally { prompter.close(); }
      return;
    }
    throw new Error('用法：project add project|repo|.');
  }

  if (command === 'list' || command === 'status') {
    const entries = await scanRegistry(registry, { fetch: options.fetch });
    if (options.json) console.log(JSON.stringify(entries, null, 2));
    else printProjectList(entries);
    return;
  }
  if (command === 'inspect') {
    const found = findRepository(registry, subcommand);
    if (!found) throw new Error(`找不到代码库：${subcommand}`);
    return printInspect(found.project, found.repository, await getGitStatus(found.repository.path));
  }
  if (command === 'pending') return showPending(registry, options);
  if (command === 'push') {
    if (options.all) return pushMany(registry, options);
    const found = findRepository(registry, subcommand);
    if (!found) throw new Error(`找不到代码库：${subcommand}`);
    if (options.fetch) await fetchRepository(found.repository.path);
    const status = await getGitStatus(found.repository.path);
    const eligibility = getPushEligibility(status);
    if (!eligibility.eligible) throw new Error(`不能推送：${eligibility.reason}`);
    printInspect(found.project, found.repository, status);
    if (options['dry-run']) return;
    if (!options.yes) {
      const prompter = createPrompter();
      try { if (!await prompter.confirm(`推送到 ${status.upstream}`)) return; } finally { prompter.close(); }
    }
    await pushRepository(found.repository.path);
    console.log('推送完成。');
    return;
  }
  if (command === 'open') {
    const found = findRepository(registry, subcommand);
    if (!found) throw new Error(`找不到代码库：${subcommand}`);
    const opener = resolveOpener(registry, found.project, found.repository, options.with);
    const target = found.repository.openTarget || found.repository.path;
    const invocation = await openPath(opener, target, { dryRun: options['dry-run'] });
    if (!options['dry-run']) {
      found.repository.lastOpenerId = opener.id;
      await saveRegistry(registryPath, registry);
    }
    const shownCommand = invocation.displayCommand || invocation.command;
    const shownArgs = invocation.displayArgs || invocation.args;
    console.log(`${options['dry-run'] ? '将执行' : '已使用'} ${opener.name}：${shownCommand} ${shownArgs.join(' ')}`);
    return;
  }
  if (command === 'path') {
    const found = findRepository(registry, subcommand);
    if (!found) throw new Error(`找不到代码库：${subcommand}`);
    if (!options.copy) return console.log(found.repository.path);
    await copyPath(found.repository.path);
    console.log(`已复制：${found.repository.path}`);
    return;
  }
  if (command === 'remove') {
    const type = subcommand;
    const reference = third;
    const removed = type === 'project' ? removeProject(registry, reference) : type === 'repo' ? removeRepository(registry, reference) : null;
    if (!removed) throw new Error('用法：project remove project|repo <name>');
    if (!options.yes) {
      const prompter = createPrompter();
      try {
        const label = type === 'project' ? `${removed.name} 及其 ${removed.repositories.length} 个代码库索引` : `${removed.project.name}/${removed.repository.name} 索引`;
        if (!await prompter.confirm(`只从注册表移除 ${label}，不会删除磁盘文件。确认继续`)) return;
      } finally { prompter.close(); }
    }
    await saveRegistry(registryPath, registry);
    console.log('索引已移除，磁盘文件未改动。');
    return;
  }
  if (command === 'opener') {
    if (subcommand === 'list') {
      if (options.json) return console.log(JSON.stringify(registry.openers, null, 2));
      for (const opener of registry.openers) {
        const defaultMarker = opener.id === registry.settings.defaultOpenerId ? ' [默认]' : '';
        const modeMarker = openerMode(opener) === 'terminal' ? ' [Terminal]' : '';
        console.log(`${opener.id.padEnd(24)} ${opener.name}${defaultMarker}${modeMarker}  ${opener.command} ${opener.args.join(' ')}`);
      }
      return;
    }
    if (subcommand === 'get') {
      const opener = findOpener(registry, third);
      if (!opener) throw new Error(`找不到打开工具：${third}`);
      if (options.json) return console.log(JSON.stringify(opener, null, 2));
      console.log(`id       ${opener.id}`);
      console.log(`名称     ${opener.name}`);
      console.log(`命令     ${opener.command}`);
      console.log(`参数     ${opener.args.join(' ')}`);
      console.log(`模式     ${openerMode(opener)}`);
      console.log(`默认     ${opener.id === registry.settings.defaultOpenerId ? '是' : '否'}`);
      return;
    }
    if (subcommand === 'add') {
      const opener = addOpener(registry, { id: options.id, name: options.name, command: options.command, args: options.arg, mode: options.mode });
      await saveRegistry(registryPath, registry);
      console.log(`已添加打开工具：${opener.name}`);
      return;
    }
    if (subcommand === 'update') {
      const opener = updateOpener(registry, third, { name: options.name, command: options.command, args: options.arg, mode: options.mode });
      await saveRegistry(registryPath, registry);
      console.log(`已更新打开工具：${opener.name}`);
      return;
    }
    if (subcommand === 'remove') {
      const opener = findOpener(registry, third);
      if (!opener) throw new Error(`找不到打开工具：${third}`);
      if (!options.yes) {
        const prompter = createPrompter();
        try { if (!await prompter.confirm(`从注册表删除打开工具 ${opener.name}`)) return; } finally { prompter.close(); }
      }
      removeOpener(registry, third);
      await saveRegistry(registryPath, registry);
      console.log(`已删除打开工具：${opener.name}`);
      return;
    }
    if (subcommand === 'default') {
      if (!third) {
        const opener = resolveOpener(registry, null, null);
        console.log(`${opener.id}\t${opener.name}`);
        return;
      }
      const opener = setDefaultOpener(registry, third);
      await saveRegistry(registryPath, registry);
      console.log(`默认打开工具已设置为：${opener.name}`);
      return;
    }
    throw new Error('用法：project opener list|get|add|update|remove|default');
  }
  help();
  process.exitCode = 1;
}
