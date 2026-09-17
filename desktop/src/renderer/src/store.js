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
  operation: null,
  scanBlocking: false,
  scanStartedAt: null,
  scanFailures: [],
});

export const interactionBlocked = computed(() => Boolean(state.operation || (state.scanning && state.scanBlocking)));

export async function withOperation(title, detail, action) {
  if (state.operation) return;
  state.operation = { title, detail, startedAt: Date.now(), completed: null, total: null };
  try { return await action(); } finally { state.operation = null; }
}

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
  const previousPaths = new Map(repositories.value.map(({ repository }) => [repository.id, repository.path]));
  const registryChanged = state.registryPath !== snapshot.registryPath;
  state.registry = snapshot.registry;
  state.registryPath = snapshot.registryPath;
  state.schemaVersion = snapshot.schemaVersion;
  state.desktopVersion = snapshot.desktopVersion;
  const currentPaths = new Map(repositories.value.map(({ repository }) => [repository.id, repository.path]));
  for (const id of Object.keys(state.statusByRepository)) {
    if (registryChanged || !currentPaths.has(id) || currentPaths.get(id) !== previousPaths.get(id)) delete state.statusByRepository[id];
  }
  if (registryChanged) state.lastScanCompletedAt = null;
  selectDefaults();
}

export function setNotice(kind, message) {
  state.notice = { kind, message };
  window.setTimeout(() => {
    if (state.notice?.message === message) state.notice = null;
  }, 4200);
}

export async function runAction(action, successMessage, operation) {
  try {
    const result = operation
      ? await withOperation(operation.title, operation.detail, action)
      : await action();
    if (result?.registry) applySnapshot(result);
    if (successMessage) setNotice('success', successMessage);
    return result;
  } catch (error) {
    const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
    setNotice('error', message);
    throw error;
  }
}

export async function runRepositoryAction(repositoryId, action, successMessage, operation) {
  return runAction(async () => {
    const status = await action();
    state.statusByRepository[repositoryId] = status;
    return status;
  }, successMessage, operation);
}

export async function refreshRepository(repositoryId) {
  if (interactionBlocked.value || state.scanning) return null;
  const item = repositories.value.find(({ repository }) => repository.id === repositoryId);
  if (!item) return null;
  return runRepositoryAction(
    repositoryId,
    () => api.fetchRepository(repositoryId),
    '当前代码库状态已刷新',
    {
      title: '正在刷新当前代码库',
      detail: `${item.project.name}/${item.repository.name}：正在获取最新远端提交，再更新本地状态与远端差异。`,
    },
  );
}

export async function startScan({ background = false } = {}) {
  if (state.scanning) return null;
  state.scanning = true;
  state.scanBlocking = !background;
  state.scanStartedAt = Date.now();
  state.scanFailures = [];
  state.scanProgress = { completed: 0, total: repositories.value.length };
  try {
    const result = await api.startScan({ fetch: true });
    for (const entry of result.entries) {
      for (const item of entry.repositories) {
        state.statusByRepository[item.repository.id] = item.status;
        if (item.status.fetchError || item.status.kind === 'error') {
          state.scanFailures.push({ name: `${entry.project.name}/${item.repository.name}`, message: item.status.fetchError || item.status.error });
        }
      }
    }
    state.scanProgress = { completed: repositories.value.length, total: repositories.value.length };
    state.lastScanCompletedAt = new Date().toISOString();
    if (!background) setNotice(state.scanFailures.length ? 'error' : 'success', state.scanFailures.length
      ? `${state.scanFailures.length} 个代码库未能完整刷新，请查看失败详情`
      : '已获取远端状态，本地与远端差异已更新');
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
    await startScan({ background: true });
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
