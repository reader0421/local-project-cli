import { contextBridge, ipcRenderer } from 'electron';

const api = {
  recordRepositoryVisit: (id) => ipcRenderer.invoke('repository:visit', id),
  navigationReady: () => ipcRenderer.invoke('navigation:ready'),
  onRepositoryNavigate: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('repository:navigate', handler);
    return () => ipcRenderer.removeListener('repository:navigate', handler);
  },
  onUsageError: (listener) => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('usage:error', handler);
    return () => ipcRenderer.removeListener('usage:error', handler);
  },
  setDefaultTerminal: (id) => ipcRenderer.invoke('terminal:default', id),
  saveRepositoryCommand: (repositoryId, input, id) => ipcRenderer.invoke('repository:command-save', { repositoryId, input, id }),
  removeRepositoryCommand: (repositoryId, id) => ipcRenderer.invoke('repository:command-remove', { repositoryId, id }),
  runRepositoryCommand: (repositoryId, id) => ipcRenderer.invoke('repository:command-run', { repositoryId, id }),
  getState: () => ipcRenderer.invoke('state:get'),
  startScan: (options) => ipcRenderer.invoke('scan:start', options),
  onScanProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },
  addProject: (input) => ipcRenderer.invoke('project:add', input),
  updateProject: (id, changes) => ipcRenderer.invoke('project:update', { id, changes }),
  removeProject: (id) => ipcRenderer.invoke('project:remove', id),
  addProjectWebhook: (projectId, input) => ipcRenderer.invoke('project:webhook-add', { projectId, ...input }),
  updateProjectWebhook: (projectId, id, changes) => ipcRenderer.invoke('project:webhook-update', { projectId, id, changes }),
  removeProjectWebhook: (projectId, id) => ipcRenderer.invoke('project:webhook-remove', { projectId, id }),
  triggerProjectWebhook: (projectId, id) => ipcRenderer.invoke('project:webhook-trigger', { projectId, id }),
  addRepository: (input) => ipcRenderer.invoke('repository:add', input),
  updateRepository: (id, changes) => ipcRenderer.invoke('repository:update', { id, changes }),
  removeRepository: (id) => ipcRenderer.invoke('repository:remove', id),
  addOpener: (input) => ipcRenderer.invoke('opener:add', input),
  updateOpener: (id, changes) => ipcRenderer.invoke('opener:update', { id, changes }),
  removeOpener: (id) => ipcRenderer.invoke('opener:remove', id),
  setDefaultOpener: (id) => ipcRenderer.invoke('opener:default', id),
  openRepository: (repositoryId, openerId) => ipcRenderer.invoke('repository:open', { repositoryId, openerId }),
  showRepository: (id) => ipcRenderer.invoke('repository:show', id),
  copyRepositoryPath: (id) => ipcRenderer.invoke('repository:copy-path', id),
  getRepositoryStatus: (id) => ipcRenderer.invoke('repository:status', id),
  fetchRepository: (id) => ipcRenderer.invoke('repository:fetch', id),
  pushRepository: (id) => ipcRenderer.invoke('repository:push', id),
  pullRepository: (id) => ipcRenderer.invoke('repository:pull', id),
  chooseDirectory: () => ipcRenderer.invoke('dialog:directory'),
  chooseRegistry: () => ipcRenderer.invoke('registry:choose'),
  showRegistry: () => ipcRenderer.invoke('registry:show'),
  copyRegistryPath: () => ipcRenderer.invoke('registry:copy-path'),
};

contextBridge.exposeInMainWorld('localProject', api);
