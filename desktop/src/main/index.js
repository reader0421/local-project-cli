import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
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

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow;
let scanSequence = 0;

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
  return {
    registry,
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
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('scan:progress', payload);
}

function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('scan:start', async (_event, { fetch = false } = {}) => {
    const sequence = ++scanSequence;
    const { registry } = await snapshot();
    const entries = await scanRegistry(registry, {
      fetch,
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
    const { registry } = await snapshot();
    const { webhook } = requireProjectWebhook(registry, projectId, id);
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'));
}

app.whenReady().then(() => {
  app.setName('LocalProject');
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
