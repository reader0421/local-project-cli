import { computed, reactive } from 'vue';
import { mockApi } from './mock-api.js';

const api = window.localProject || mockApi;

export const state = reactive({
  ready: false,
  loading: true,
  navigation: 'projects',
  registry: { projects: [], openers: [], settings: {} },
  registryPath: '',
  schemaVersion: null,
  desktopVersion: '',
  statusByRepository: {},
  selectedProjectId: null,
  selectedRepositoryId: null,
  scanning: false,
  scanProgress: { completed: 0, total: 0 },
  lastScanCompletedAt: null,
  notice: null,
});

export const projects = computed(() => state.registry.projects || []);
export const selectedProject = computed(() => projects.value.find((project) => project.id === state.selectedProjectId) || null);
export const selectedRepository = computed(() => selectedProject.value?.repositories.find((repository) => repository.id === state.selectedRepositoryId) || null);
export const repositories = computed(() => projects.value.flatMap((project) => project.repositories.map((repository) => ({ project, repository, status: state.statusByRepository[repository.id] }))));
export const selectedStatus = computed(() => state.statusByRepository[state.selectedRepositoryId] || null);
export const unpushedRepositories = computed(() => repositories.value.filter((item) => item.status?.kind === 'git' && item.status.ahead > 0));

function selectDefaults() {
  if (!projects.value.some((project) => project.id === state.selectedProjectId)) state.selectedProjectId = projects.value[0]?.id || null;
  const currentProject = selectedProject.value;
  if (!currentProject?.repositories.some((repository) => repository.id === state.selectedRepositoryId)) {
    state.selectedRepositoryId = currentProject?.repositories[0]?.id || null;
  }
}

function applySnapshot(snapshot) {
  state.registry = snapshot.registry;
  state.registryPath = snapshot.registryPath;
  state.schemaVersion = snapshot.schemaVersion;
  state.desktopVersion = snapshot.desktopVersion;
  selectDefaults();
}

export function setNotice(kind, message) {
  state.notice = { kind, message };
  window.setTimeout(() => {
    if (state.notice?.message === message) state.notice = null;
  }, 4200);
}

export async function runAction(action, successMessage) {
  try {
    const result = await action();
    if (result?.registry) applySnapshot(result);
    if (successMessage) setNotice('success', successMessage);
    return result;
  } catch (error) {
    const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
    setNotice('error', message);
    throw error;
  }
}

export async function startScan({ fetch = false } = {}) {
  if (state.scanning) return null;
  state.scanning = true;
  state.scanProgress = { completed: 0, total: repositories.value.length };
  try {
    const result = await api.startScan({ fetch });
    for (const entry of result.entries) {
      for (const item of entry.repositories) state.statusByRepository[item.repository.id] = item.status;
    }
    state.scanProgress = { completed: repositories.value.length, total: repositories.value.length };
    state.lastScanCompletedAt = new Date().toISOString();
    return result;
  } catch (error) {
    setNotice('error', `Git 状态读取失败：${error.message}`);
    return null;
  } finally {
    state.scanning = false;
  }
}

export async function initialize() {
  const removeProgressListener = api.onScanProgress?.((progress) => {
    state.scanProgress = { completed: progress.completed, total: progress.total };
    if (progress.repository && progress.status) state.statusByRepository[progress.repository.id] = progress.status;
  });
  try {
    applySnapshot(await api.getState());
    state.ready = true;
    state.loading = false;
    await startScan();
  } catch (error) {
    setNotice('error', `启动失败：${error.message}`);
  } finally {
    state.loading = false;
  }
  return removeProgressListener;
}

export function selectProject(projectId) {
  state.selectedProjectId = projectId;
  const project = projects.value.find((item) => item.id === projectId);
  state.selectedRepositoryId = project?.repositories[0]?.id || null;
  state.navigation = 'projects';
}

export function selectRepository(projectId, repositoryId) {
  state.selectedProjectId = projectId;
  state.selectedRepositoryId = repositoryId;
  state.navigation = 'projects';
}

export { api };
