import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  addProject,
  addProjectWebhook,
  addRepository,
  findProject,
  findProjectWebhook,
  findRepository,
  loadRegistry,
  removeProject,
  removeProjectWebhook,
  removeRepository,
  resolveRegistryPath,
  saveRegistry,
  updateProject,
  updateProjectWebhook,
  updateRepository,
} from '../../../src/registry.js';
import {
  addOpener,
  openPath,
  removeOpener,
  resolveOpener,
  setDefaultOpener,
  updateOpener,
} from '../../../src/openers.js';
import { fetchRepository, getGitStatus, getPullEligibility, getPushEligibility, pullRepository, pushRepository } from '../../../src/git.js';
import { scanRegistry } from '../../../src/scanner.js';
import { SCHEMA_VERSION } from '../../../src/constants.js';
import { triggerWebhook } from '../../../src/webhooks.js';
import { findRepositoryCommand, saveRepositoryCommand, removeRepositoryCommand, validateTerminal } from '../../../src/repository-commands.js';
import { runInTerminal } from './command-terminal.js';
import { UsageStore } from './usage-store.js';
import trayIconPath from '../../resources/TrayTemplate.png?asset';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow;
let scanSequence = 0;
let usageStore;
let tray;
let rendererReady = false;
let pendingNavigation = null;
let trayMenuLoading = false;

function preferencesPath() {
  return join(app.getPath('userData'), 'preferences.json');
}

async function readPreferences() {
  try {
    return JSON.parse(await readFile(preferencesPath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writePreferences(preferences) {
  const path = preferencesPath();
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function currentRegistryPath() {
  const preferences = await readPreferences();
  return resolveRegistryPath(preferences.registryPath);
}

async function snapshot() {
  const registryPath = await currentRegistryPath();
  const registry = await loadRegistry(registryPath);
  const projectOrder = await usageStore.projectOrder(registryPath, registry.projects);
  return {
    registry,
    projectOrder,
    registryPath,
    schemaVersion: SCHEMA_VERSION,
    desktopVersion: app.getVersion(),
    platform: process.platform,
  };
}

async function mutateRegistry(mutator) {
  const registryPath = await currentRegistryPath();
  const registry = await loadRegistry(registryPath);
  const result = await mutator(registry);
  await saveRegistry(registryPath, registry);
  return { result, ...(await snapshot()) };
}

function requireProject(registry, projectId) {
  const project = findProject(registry, projectId);
  if (!project) throw new Error('找不到项目，请重新读取注册表');
  return project;
}

function requireRepository(registry, repositoryId) {
  const found = findRepository(registry, repositoryId);
  if (!found) throw new Error('找不到代码库，请重新读取注册表');
  return found;
}

function requireProjectWebhook(registry, projectId, webhookId) {
  const project = requireProject(registry, projectId);
  const webhook = findProjectWebhook(project, webhookId);
  if (!webhook) throw new Error('找不到 Webhook，请重新读取注册表');
  return { project, webhook };
}

function sendScanProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:progress', payload);
}

async function recordUsage(registryPath, projectId, repositoryId) {
  try {
    await usageStore.record(registryPath, projectId, repositoryId);
  } catch (error) {
    // 统计故障不能阻止原有命令或 webhook 执行。
    console.error('常用次数保存失败：', error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('usage:error', '常用次数保存失败，请检查本机应用数据目录是否可写。');
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  app.focus({ steal: true });
}

async function openTrayRepository(repositoryId) {
  const { registry, registryPath } = await snapshot();
  const { project, repository } = requireRepository(registry, repositoryId);
  pendingNavigation = { projectId: project.id, repositoryId, registryPath };
  showMainWindow();
  if (rendererReady) {
    mainWindow.webContents.send('repository:navigate', pendingNavigation);
    pendingNavigation = null;
  }
  const opener = resolveOpener(registry, project, repository);
  await openPath(opener, repository.openTarget || repository.path);
}

function createTray() {
  if (process.platform !== 'darwin') return;
  const source = nativeImage.createFromPath(trayIconPath);
  const icon = source.resize({ width: 18, height: 18 });
  icon.addRepresentation({ scaleFactor: 2, buffer: source.resize({ width: 36, height: 36 }).toPNG() });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('LocalProject · 最近常用代码库');
  tray.setIgnoreDoubleClickEvents(true);
  const showMenu = async () => {
    if (trayMenuLoading) return;
    trayMenuLoading = true;
    try {
      const { registry, registryPath } = await snapshot();
      const entries = await usageStore.trayRepositories(registryPath, registry.projects);
      tray.popUpContextMenu(Menu.buildFromTemplate([
        { label: '最近常用代码库 · 24 小时', enabled: false },
        ...entries.map(({ project, repository }) => ({
          label: `${project.name} / ${repository.name}`,
          click: () => openTrayRepository(repository.id).catch((error) => dialog.showErrorBox('打开代码库失败', error.message)),
        })),
        ...(!entries.length ? [{ label: '还没有代码库', enabled: false }] : []),
        { type: 'separator' },
        { label: '打开 LocalProject', click: showMainWindow },
        { label: '退出 LocalProject', click: () => app.quit() },
      ]));
    } catch (error) {
      dialog.showErrorBox('读取常用代码库失败', error.message);
    } finally {
      trayMenuLoading = false;
    }
  };
  tray.on('click', showMenu);
  tray.on('right-click', showMenu);
}

function registerIpc() {
  ipcMain.handle('repository:visit', async (_event, repositoryId) => {
    const { registry, registryPath } = await snapshot();
    const { project, repository } = requireRepository(registry, repositoryId);
    await recordUsage(registryPath, project.id, repository.id);
  });
  ipcMain.handle('navigation:ready', () => {
    rendererReady = true;
    const target = pendingNavigation;
    pendingNavigation = null;
    return target;
  });
  ipcMain.handle('terminal:default', (_event, id) => mutateRegistry((registry) => {
    registry.settings.defaultTerminalId = validateTerminal(id);
  }));
  ipcMain.handle('repository:command-save', (_event, { repositoryId, id, input }) => mutateRegistry((registry) => {
    const { project, repository } = requireRepository(registry, repositoryId);
    const command = saveRepositoryCommand(repository, input, id);
    project.updatedAt = repository.updatedAt;
    return command;
  }));
  ipcMain.handle('repository:command-remove', (_event, { repositoryId, id }) => mutateRegistry((registry) => {
    const { project, repository } = requireRepository(registry, repositoryId);
    const command = removeRepositoryCommand(repository, id);
    project.updatedAt = repository.updatedAt;
    return command;
  }));
  ipcMain.handle('repository:command-run', async (_event, { repositoryId, id }) => {
    const { registry, registryPath } = await snapshot();
    const { project, repository } = requireRepository(registry, repositoryId);
    const command = findRepositoryCommand(repository, id);
    await recordUsage(registryPath, project.id, repository.id);
    return runInTerminal(registry.settings.defaultTerminalId || 'terminal', repository.path, command.command);
  });
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('scan:start', async () => {
    const sequence = ++scanSequence;
    const { registry } = await snapshot();
    const entries = await scanRegistry(registry, {
      fetch: true,
      onProgress(progress) {
        sendScanProgress({ sequence, ...progress });
      },
    });
    return { sequence, entries };
  });

  ipcMain.handle('project:add', (_event, input) => mutateRegistry((registry) => addProject(registry, input)));
  ipcMain.handle('project:update', (_event, { id, changes }) => mutateRegistry((registry) => updateProject(registry, id, changes)));
  ipcMain.handle('project:remove', (_event, projectId) => mutateRegistry((registry) => removeProject(registry, projectId)));
  ipcMain.handle('project:webhook-add', (_event, { projectId, ...input }) => (
    mutateRegistry((registry) => addProjectWebhook(registry, projectId, input))
  ));
  ipcMain.handle('project:webhook-update', (_event, { projectId, id, changes }) => (
    mutateRegistry((registry) => updateProjectWebhook(registry, projectId, id, changes))
  ));
  ipcMain.handle('project:webhook-remove', (_event, { projectId, id }) => (
    mutateRegistry((registry) => removeProjectWebhook(registry, projectId, id))
  ));
  ipcMain.handle('project:webhook-trigger', async (_event, { projectId, id }) => {
    const { registry, registryPath } = await snapshot();
    const { webhook } = requireProjectWebhook(registry, projectId, id);
    await recordUsage(registryPath, projectId);
    return triggerWebhook(webhook);
  });
  ipcMain.handle('repository:add', (_event, { projectId, ...input }) => mutateRegistry(async (registry) => (
    addRepository(registry, requireProject(registry, projectId), input)
  )));
  ipcMain.handle('repository:remove', (_event, repositoryId) => mutateRegistry((registry) => removeRepository(registry, repositoryId)));
  ipcMain.handle('repository:update', (_event, { id, changes }) => mutateRegistry((registry) => updateRepository(registry, id, changes)));

  ipcMain.handle('opener:add', (_event, input) => mutateRegistry((registry) => addOpener(registry, input)));
  ipcMain.handle('opener:update', (_event, { id, changes }) => mutateRegistry((registry) => updateOpener(registry, id, changes)));
  ipcMain.handle('opener:remove', (_event, id) => mutateRegistry((registry) => removeOpener(registry, id)));
  ipcMain.handle('opener:default', (_event, id) => mutateRegistry((registry) => setDefaultOpener(registry, id)));

  ipcMain.handle('repository:open', async (_event, { repositoryId, openerId }) => {
    const { registry } = await snapshot();
    const { project, repository } = requireRepository(registry, repositoryId);
    const opener = resolveOpener(registry, project, repository, openerId);
    await openPath(opener, repository.openTarget || repository.path);
    return { openerId: opener.id, openerName: opener.name };
  });
  ipcMain.handle('repository:show', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    shell.showItemInFolder(repository.path);
    return true;
  });
  ipcMain.handle('repository:copy-path', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    clipboard.writeText(repository.path);
    return repository.path;
  });
  ipcMain.handle('repository:status', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    return getGitStatus(repository.path);
  });
  ipcMain.handle('repository:fetch', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    await fetchRepository(repository.path);
    return getGitStatus(repository.path);
  });
  ipcMain.handle('repository:push', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    const status = await getGitStatus(repository.path);
    const eligibility = getPushEligibility(status);
    if (!eligibility.eligible) throw new Error(`不能推送：${eligibility.reason}`);
    await pushRepository(repository.path);
    return getGitStatus(repository.path);
  });
  ipcMain.handle('repository:pull', async (_event, repositoryId) => {
    const { registry } = await snapshot();
    const { repository } = requireRepository(registry, repositoryId);
    await fetchRepository(repository.path);
    const status = await getGitStatus(repository.path);
    const eligibility = getPullEligibility(status);
    if (!eligibility.eligible) throw new Error(`不能拉取：${eligibility.reason}`);
    await pullRepository(repository.path);
    return getGitStatus(repository.path);
  });

  ipcMain.handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('registry:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'createDirectory'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    const registryPath = result.filePaths[0];
    await loadRegistry(registryPath, { create: false });
    const preferences = await readPreferences();
    await writePreferences({ ...preferences, registryPath });
    return snapshot();
  });
  ipcMain.handle('registry:show', async () => {
    shell.showItemInFolder(await currentRegistryPath());
    return true;
  });
  ipcMain.handle('registry:copy-path', async () => {
    const path = await currentRegistryPath();
    clipboard.writeText(path);
    return path;
  });
}

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#101010',
    title: 'LocalProject',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    rendererReady = false;
    mainWindow = null;
  });
  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.whenReady().then(async () => {
  app.setName('LocalProject');
  usageStore = new UsageStore(join(app.getPath('userData'), 'usage'));
  // 在任何交互前固定本次进程的排序，关闭窗口后重新打开也沿用。
  await snapshot();
  registerIpc();
  createWindow();
  createTray();
  const cleanup = setInterval(() => {
    currentRegistryPath().then((path) => usageStore.cleanup(path)).catch((error) => console.error('清理常用记录失败：', error));
  }, 60 * 60 * 1000);
  cleanup.unref();
  app.on('activate', () => {
    showMainWindow();
  });
  app.on('second-instance', showMainWindow);
}).catch((error) => {
  dialog.showErrorBox('启动失败', error.message);
  app.quit();
});

let quitAfterFlush = false;
app.on('before-quit', (event) => {
  if (!usageStore || quitAfterFlush) return;
  event.preventDefault();
  usageStore.flush().finally(() => {
    quitAfterFlush = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
