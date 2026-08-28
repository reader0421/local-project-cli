<script setup>
import { computed, ref, watch } from 'vue';
import {
  PhFolder as Folder,
  PhGitBranch as GitBranch,
  PhMonitor as Monitor,
  PhPlus as Plus,
  PhDotsThree as DotsThree,
  PhCopy as Copy,
  PhCode as Code,
  PhGitCommit as GitCommit,
  PhUploadSimple as UploadSimple,
  PhFolderOpen as FolderOpen,
  PhArrowClockwise as ArrowClockwise,
  PhCloudArrowDown as CloudArrowDown,
  PhTrash as Trash,
  PhPencilSimple as PencilSimple,
  PhWrench as Wrench,
} from '@phosphor-icons/vue';
import BaseModal from '../components/BaseModal.vue';
import { formatDate, middleEllipsis, pullEligibility, pushEligibility } from '../format.js';
import {
  api,
  projects,
  runAction,
  selectedProject,
  selectedRepository,
  selectedStatus,
  selectProject,
  selectRepository,
  startScan,
  state,
} from '../store.js';

const modal = ref(null);
const busy = ref(false);
const projectForm = ref({ name: '', workspacePath: '' });
const repositoryForm = ref({ name: '', path: '', openerId: '', openTarget: '' });
const projectRenameForm = ref({ name: '' });
const repositoryRenameForm = ref({ name: '' });
const repositoryDefaultOpenerId = ref('');
const expandedChanges = ref(false);
const expandedCommits = ref(false);
const expandedRemoteCommits = ref(false);
const listPreviewLimit = 10;

function nameInitial(name) {
  return Array.from(name?.trim() || '?')[0].toLocaleUpperCase();
}

const defaultOpener = computed(() => {
  const id = selectedRepository.value?.defaultOpenerId || state.registry.settings.defaultOpenerId;
  return state.registry.openers.find((opener) => opener.id === id) || state.registry.openers[0];
});
const pushEligibilityStatus = computed(() => pushEligibility(selectedStatus.value));
const pullEligibilityStatus = computed(() => pullEligibility(selectedStatus.value));
const visibleChanges = computed(() => {
  const changes = selectedStatus.value?.changes || [];
  return expandedChanges.value ? changes : changes.slice(0, listPreviewLimit);
});
const visibleUnpushedCommits = computed(() => {
  const commits = selectedStatus.value?.unpushedCommits || [];
  return expandedCommits.value ? commits : commits.slice(0, listPreviewLimit);
});
const visibleRemoteCommits = computed(() => {
  const commits = selectedStatus.value?.remoteCommits || [];
  return expandedRemoteCommits.value ? commits : commits.slice(0, listPreviewLimit);
});
const recentCommits = computed(() => {
  const commits = selectedStatus.value?.recentCommits;
  if (commits?.length) return commits.slice(0, 5);
  return selectedStatus.value?.lastCommit ? [selectedStatus.value.lastCommit] : [];
});
function repositoryHealth(status) {
  if (!status) return '';
  if (status.kind === 'error' || status.dirty || status.behind > 0 || status.detached || status.operation) return 'danger';
  if (status.kind === 'non_git' || !status.upstream || status.ahead > 0) return 'warning';
  return 'healthy';
}
const localGitStates = computed(() => {
  const status = selectedStatus.value;
  if (!status) return [{ tone: 'loading', text: '正在读取 Git 状态' }];
  if (status.kind === 'non_git') return [{ tone: 'warning', text: '当前目录尚未初始化 Git' }];
  if (status.kind === 'error') return [{ tone: 'danger', text: 'Git 状态读取失败' }];
  const items = [];
  if (status.changes?.length) items.push({ tone: 'danger', text: `${status.changes.length} 个文件修改未提交` });
  if (status.ahead > 0) items.push({ tone: 'warning', text: `${status.ahead} 个提交未推送` });
  if (status.behind > 0) items.push({ tone: 'danger', text: `${status.behind} 个提交未拉取` });
  if (!status.upstream) items.push({ tone: 'warning', text: '当前分支未设置上游分支' });
  if (status.detached) items.push({ tone: 'danger', text: '当前处于 detached HEAD 状态' });
  if (status.operation) items.push({ tone: 'danger', text: `正在进行 ${status.operation}` });
  return items.length ? items : [{ tone: 'success', text: '本地状态正常' }];
});

watch(() => selectedRepository.value?.id, () => {
  expandedChanges.value = false;
  expandedCommits.value = false;
  expandedRemoteCommits.value = false;
});

async function chooseRepositoryDirectory() {
  const path = await api.chooseDirectory();
  if (!path) return;
  repositoryForm.value.path = path;
  if (!repositoryForm.value.name) repositoryForm.value.name = path.split('/').filter(Boolean).at(-1) || '';
}

async function addProject() {
  const response = await runAction(() => api.addProject({
    name: projectForm.value.name,
    workspacePath: projectForm.value.workspacePath || undefined,
  }), '项目已添加');
  if (response?.result?.id) selectProject(response.result.id);
  projectForm.value = { name: '', workspacePath: '' };
  modal.value = null;
  await startScan();
}

async function addRepository() {
  const response = await runAction(() => api.addRepository({
    projectId: selectedProject.value.id,
    name: repositoryForm.value.name,
    path: repositoryForm.value.path,
    openerId: repositoryForm.value.openerId || undefined,
    openTarget: repositoryForm.value.openTarget || undefined,
  }), '代码库已添加');
  repositoryForm.value = { name: '', path: '', openerId: '', openTarget: '' };
  modal.value = null;
  if (response?.result?.id) selectRepository(selectedProject.value.id, response.result.id);
  await startScan();
}

function openRenameProject() {
  projectRenameForm.value = { name: selectedProject.value?.name || '' };
  modal.value = 'rename-project';
}

async function renameProject() {
  await runAction(() => api.updateProject(selectedProject.value.id, { name: projectRenameForm.value.name }), '项目名称已更新');
  modal.value = null;
}

function openRenameRepository() {
  repositoryRenameForm.value = { name: selectedRepository.value?.name || '' };
  modal.value = 'rename-repository';
}

async function renameRepository() {
  await runAction(() => api.updateRepository(selectedRepository.value.id, { name: repositoryRenameForm.value.name }), '代码库名称已更新');
  modal.value = null;
}

function openRepositoryDefaultOpener() {
  repositoryDefaultOpenerId.value = selectedRepository.value?.defaultOpenerId || '';
  modal.value = 'repository-default-opener';
}

async function saveRepositoryDefaultOpener() {
  const selectedId = repositoryDefaultOpenerId.value || null;
  await runAction(
    () => api.updateRepository(selectedRepository.value.id, { defaultOpenerId: selectedId }),
    selectedId ? '代码库默认打开工具已更新' : '代码库已改为跟随全局默认工具',
  );
  modal.value = null;
}

async function openRepository(openerId) {
  busy.value = true;
  try {
    const response = await runAction(() => api.openRepository(selectedRepository.value.id, openerId), `已使用 ${openerId ? state.registry.openers.find((item) => item.id === openerId)?.name : defaultOpener.value?.name} 打开`);
    if (response?.registry) state.registry = response.registry;
    modal.value = null;
  } finally { busy.value = false; }
}

async function fetchCurrent() {
  busy.value = true;
  try {
    await runAction(() => api.fetchRepository(selectedRepository.value.id), '远端状态已更新');
    await startScan();
  } finally { busy.value = false; }
}

async function copyCurrentPath() {
  await runAction(() => api.copyRepositoryPath(selectedRepository.value.id), '代码库地址已复制');
}

async function pushCurrent() {
  busy.value = true;
  try {
    await runAction(() => api.pushRepository(selectedRepository.value.id), '推送完成');
    modal.value = null;
    await startScan();
  } finally { busy.value = false; }
}

async function pullCurrent() {
  busy.value = true;
  try {
    await runAction(() => api.pullRepository(selectedRepository.value.id), '安全拉取完成');
    modal.value = null;
    await startScan();
  } finally { busy.value = false; }
}

async function removeCurrentRepository() {
  await runAction(() => api.removeRepository(selectedRepository.value.id), '代码库索引已移除，磁盘文件未改动');
  modal.value = null;
  selectProject(selectedProject.value.id);
  await startScan();
}

async function removeCurrentProject() {
  await runAction(() => api.removeProject(selectedProject.value.id), '项目索引已移除，磁盘文件未改动');
  modal.value = null;
  selectProject(projects.value[0]?.id || null);
  await startScan();
}
</script>

<template>
  <div class="projects-workbench">
    <aside class="project-list-panel">
      <div class="rail-heading">
        <div><p class="eyebrow">PROJECTS</p><h2>项目列表</h2></div>
        <button class="icon-button" title="添加项目" @click="modal = 'add-project'"><Plus :size="18" /></button>
      </div>
      <div v-if="projects.length" class="project-list">
        <button v-for="project in projects" :key="project.id" :class="{ active: project.id === state.selectedProjectId }" @click="selectProject(project.id)">
          <span class="entity-initial project-initial">{{ nameInitial(project.name) }}</span>
          <div><strong>{{ project.name }}</strong><small>{{ project.repositories.length }} 个代码库</small></div>
        </button>
      </div>
      <div v-else class="subtle-empty">还没有项目。</div>
    </aside>

    <aside class="project-rail">
      <div class="rail-heading">
        <div><p class="eyebrow">当前项目</p><h2>{{ selectedProject?.name || '未选择项目' }}</h2></div>
        <button v-if="selectedProject" class="icon-button" title="项目操作" aria-label="项目操作" @click="modal = 'project-actions'"><DotsThree :size="21" /></button>
      </div>

      <div v-if="selectedProject" class="project-tree">
        <div class="tree-section-heading">
          <div><p class="eyebrow">REPOSITORIES</p><strong>代码库</strong></div>
          <div class="tree-section-actions">
            <span>{{ selectedProject.repositories.length }}</span>
            <button class="inline-add-button" title="添加代码库" aria-label="添加代码库" @click="modal = 'add-repository'"><Plus :size="17" /></button>
          </div>
        </div>
        <button
          v-for="repository in selectedProject.repositories"
          :key="repository.id"
          class="repository-tree-row"
          :class="{ active: repository.id === state.selectedRepositoryId }"
          @click="selectRepository(selectedProject.id, repository.id)"
        >
          <span class="entity-initial repository-initial">{{ nameInitial(repository.name) }}</span>
          <div><strong>{{ repository.name }}</strong><small><GitBranch :size="13" />{{ state.statusByRepository[repository.id]?.branch || '正在获取…' }}</small></div>
          <span class="repo-health" :class="repositoryHealth(state.statusByRepository[repository.id])" />
        </button>
      </div>

    </aside>

    <section v-if="selectedRepository" class="repository-inspector">
      <div class="repository-inspector-scroll">
      <header class="inspector-header">
        <div class="repo-title"><Monitor :size="32" /><div><h1>{{ selectedRepository.name }}</h1><p>{{ selectedRepository.path }}</p></div></div>
        <div class="header-actions">
          <button class="icon-button" title="刷新本地 Git 状态" aria-label="刷新本地 Git 状态" :disabled="state.scanning" @click="startScan()"><ArrowClockwise :size="18" :class="{ spin: state.scanning }" /></button>
          <button class="icon-button" title="获取远端状态" aria-label="获取远端状态" :disabled="busy" @click="fetchCurrent"><CloudArrowDown :size="18" /></button>
          <button class="icon-button" title="复制代码库地址" aria-label="复制代码库地址" @click="copyCurrentPath"><Copy :size="18" /></button>
          <button class="icon-button" title="更多操作" aria-label="更多操作" @click="modal = 'more'"><DotsThree :size="22" /></button>
        </div>
      </header>

      <section class="git-state-comparison">
        <div class="git-state-row">
          <div class="git-state-scope"><span>本地</span><small>工作区</small></div>
          <div class="git-state-field"><span>当前分支</span><strong class="branch"><GitBranch :size="20" />{{ selectedStatus?.branch || '-' }}</strong></div>
          <div class="git-state-field git-state-action-field"><div class="git-state-field-heading"><span>Git 状态</span><button class="button secondary compact" :disabled="!pushEligibilityStatus.eligible" :title="pushEligibilityStatus.reason" @click="modal = 'push'"><UploadSimple :size="16" />安全推送</button></div><div class="git-status-chips"><span v-for="item in localGitStates" :key="item.text" class="git-status-chip" :class="item.tone">{{ item.text }}</span></div></div>
        </div>
        <div class="git-state-row remote">
          <div class="git-state-scope"><span>远程</span><small>跟踪分支</small></div>
          <div class="git-state-field"><span>上游分支</span><strong class="branch"><GitBranch :size="20" />{{ selectedStatus?.upstream || '未设置' }}</strong></div>
          <div class="git-state-field remote-commit-field git-state-action-field"><div class="git-state-field-heading"><span>最后一次远端提交</span><button class="button secondary compact" :disabled="!pullEligibilityStatus.eligible" :title="pullEligibilityStatus.reason" @click="modal = 'pull'"><CloudArrowDown :size="16" />安全拉取</button></div><div v-if="selectedStatus?.upstreamCommit" class="remote-commit-summary"><strong>{{ selectedStatus.upstreamCommit.subject }}</strong><small><span>{{ selectedStatus.upstreamCommit.author || '未知提交人' }}</span><span>·</span><code>{{ selectedStatus.upstreamCommit.hash }}</code><span>·</span>{{ formatDate(selectedStatus.upstreamCommit.authoredAt) }}</small></div><strong v-else class="muted-value">{{ selectedStatus?.upstream ? '尚未读取到远端提交' : '当前分支未设置上游分支' }}</strong></div>
        </div>
      </section>

      <section v-if="selectedStatus?.changes?.length" class="detail-block">
        <div class="block-heading tone-danger"><div><PencilSimple :size="18" /><h3>未提交的文件</h3><span>{{ selectedStatus.changes.length }}</span></div></div>
        <div class="content-list"><div v-for="change in visibleChanges" :key="`${change.code}-${change.path}`" class="content-list-row"><code class="file-path" :title="change.path">{{ middleEllipsis(change.path) }}</code><span class="file-state">{{ change.code }}</span></div><button v-if="selectedStatus.changes.length > listPreviewLimit" class="list-expander" @click="expandedChanges = !expandedChanges">{{ expandedChanges ? '收起文件列表' : `查看剩余 ${selectedStatus.changes.length - listPreviewLimit} 个文件` }}</button></div>
      </section>

      <section v-if="selectedStatus?.unpushedCommits?.length" class="detail-block">
        <div class="block-heading tone-warning"><div><UploadSimple :size="18" /><h3>未推送的提交</h3><span>{{ selectedStatus.unpushedCommits.length }}</span></div></div>
        <div class="content-list"><div v-for="commit in visibleUnpushedCommits" :key="commit.hash" class="content-list-row stack"><strong>{{ commit.subject }}</strong><small><code>{{ commit.hash }}</code></small></div><button v-if="selectedStatus.unpushedCommits.length > listPreviewLimit" class="list-expander" @click="expandedCommits = !expandedCommits">{{ expandedCommits ? '收起提交列表' : `查看剩余 ${selectedStatus.unpushedCommits.length - listPreviewLimit} 个提交` }}</button></div>
      </section>

      <section v-if="selectedStatus?.behind > 0" class="detail-block remote-commits">
        <div class="block-heading tone-danger"><div><CloudArrowDown :size="18" /><h3>未拉取的远端提交</h3><span>{{ selectedStatus.behind }}</span></div></div>
        <div v-if="selectedStatus.remoteCommits?.length" class="content-list"><div v-for="commit in visibleRemoteCommits" :key="commit.hash" class="content-list-row stack"><strong>{{ commit.subject }}</strong><small><code>{{ commit.hash }}</code><span>·</span><span v-if="commit.author">{{ commit.author }} ·</span>{{ formatDate(commit.authoredAt) }}</small></div><button v-if="selectedStatus.remoteCommits.length > listPreviewLimit" class="list-expander" @click="expandedRemoteCommits = !expandedRemoteCommits">{{ expandedRemoteCommits ? '收起远端提交列表' : `查看剩余 ${selectedStatus.remoteCommits.length - listPreviewLimit} 个远端提交` }}</button></div>
        <div v-else class="subtle-empty">尚未读取到远端提交列表，请重新获取远端状态。</div>
      </section>

      <section class="detail-block">
        <div class="block-heading"><div><GitCommit :size="18" /><h3>最近提交</h3><span v-if="recentCommits.length">{{ recentCommits.length }}</span></div></div>
        <div v-if="recentCommits.length" class="content-list"><div v-for="commit in recentCommits" :key="commit.hash" class="content-list-row stack"><strong>{{ commit.subject }}</strong><small><code>{{ commit.hash }}</code><span>·</span><span v-if="commit.author">{{ commit.author }} ·</span>{{ formatDate(commit.authoredAt) }}</small></div></div>
        <div v-else class="subtle-empty">暂无提交。</div>
      </section>
      </div>

      <footer class="inspector-actions">
        <button class="button primary" :disabled="busy" @click="openRepository()"><Code :size="20" weight="fill" />使用 {{ defaultOpener?.name || '默认工具' }} 打开</button>
        <button class="button secondary" @click="modal = 'openers'"><Wrench :size="19" />选择其他工具</button>
        <button class="button secondary" @click="api.showRepository(selectedRepository.id)"><FolderOpen :size="19" />在 Finder 中显示</button>
      </footer>
    </section>

    <section v-else class="center-state"><Folder :size="36" /><h2>{{ selectedProject ? '还没有代码库' : '还没有项目' }}</h2><p>添加后即可集中查看 Git 状态并使用 opener 打开。</p><button class="button primary" @click="modal = selectedProject ? 'add-repository' : 'add-project'"><Plus :size="18" />开始添加</button></section>

    <BaseModal v-if="modal === 'add-project'" title="添加项目" @close="modal = null">
      <form class="form-stack" @submit.prevent="addProject"><label>项目名称<input v-model="projectForm.name" required autofocus /></label><label>Workspace 路径（可选）<input v-model="projectForm.workspacePath" /></label></form>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="!projectForm.name.trim()" @click="addProject">添加项目</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'rename-project'" title="修改项目名称" :description="selectedProject?.name" @close="modal = null">
      <form class="form-stack" @submit.prevent="renameProject"><label>项目名称<input v-model="projectRenameForm.name" required autofocus /></label></form>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="!projectRenameForm.name.trim() || projectRenameForm.name.trim() === selectedProject?.name" @click="renameProject">保存</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'project-actions'" title="项目操作" :description="selectedProject?.name" @close="modal = null">
      <div class="choice-list compact"><button @click="openRenameProject"><PencilSimple :size="20" /><div><strong>修改项目名称</strong><small>只修改索引中的显示名称</small></div></button><button class="danger-choice" @click="modal = 'remove-project'"><Trash :size="20" /><div><strong>移除项目索引</strong><small>同时移除项目内所有代码库索引，不会删除磁盘文件</small></div></button></div>
    </BaseModal>

    <BaseModal v-if="modal === 'rename-repository'" title="修改代码库名称" :description="selectedRepository?.path" @close="modal = null">
      <form class="form-stack" @submit.prevent="renameRepository"><label>代码库名称<input v-model="repositoryRenameForm.name" required autofocus /></label><small>只修改索引中的显示名称，不会重命名磁盘目录。</small></form>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="!repositoryRenameForm.name.trim() || repositoryRenameForm.name.trim() === selectedRepository?.name" @click="renameRepository">保存</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'add-repository'" title="添加代码库" :description="`添加到 ${selectedProject?.name}`" @close="modal = null">
      <form class="form-stack" @submit.prevent="addRepository">
        <label>代码库目录<div class="input-action"><input v-model="repositoryForm.path" required /><button type="button" class="button secondary" @click="chooseRepositoryDirectory">选择</button></div></label>
        <label>代码库名称<input v-model="repositoryForm.name" required /></label>
        <label>代码库默认打开工具（可选）<select v-model="repositoryForm.openerId"><option value="">跟随全局默认</option><option v-for="opener in state.registry.openers" :key="opener.id" :value="opener.id">{{ opener.name }}</option></select><small>只在添加时显式设置；临时选择其他工具打开不会改变它。</small></label>
        <label>打开目标（可选）<input v-model="repositoryForm.openTarget" placeholder="例如 app.code-workspace" /></label>
      </form>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="!repositoryForm.name.trim() || !repositoryForm.path" @click="addRepository">添加代码库</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'openers'" title="选择打开工具" description="仅用于本次打开，不会修改代码库默认工具。" extra-wide @close="modal = null">
      <div class="opener-choice-grid"><button v-for="opener in state.registry.openers" :key="opener.id" @click="openRepository(opener.id)"><Wrench :size="20" /><div><strong>{{ opener.name }}</strong><small>{{ opener.id }}<span v-if="opener.id === defaultOpener?.id"> · 当前默认</span></small></div></button></div>
    </BaseModal>

    <BaseModal v-if="modal === 'repository-default-opener'" title="设置代码库默认打开工具" :description="selectedRepository?.name" @close="modal = null">
      <div class="form-stack"><label>默认打开工具<select v-model="repositoryDefaultOpenerId"><option value="">跟随全局默认（{{ state.registry.openers.find((item) => item.id === state.registry.settings.defaultOpenerId)?.name }}）</option><option v-for="opener in state.registry.openers" :key="opener.id" :value="opener.id">{{ opener.name }}</option></select><small>只有在这里保存才会修改默认值；“选择其他工具”仅对当次打开生效。</small></label></div>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" @click="saveRepositoryDefaultOpener">保存</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'push'" title="确认安全推送" :description="`将 ${selectedStatus?.ahead || 0} 个提交推送到 ${selectedStatus?.upstream}`" @close="modal = null">
      <div class="confirm-panel"><UploadSimple :size="28" /><div><strong>{{ selectedRepository.name }}</strong><p v-if="selectedStatus?.dirty">当前仍有 {{ selectedStatus.changes.length }} 个未提交修改，本次只推送已有提交，不包含这些文件。</p><p v-else>当前工作区没有未提交修改。</p></div></div>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="busy" @click="pushCurrent">确认推送</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'pull'" title="确认安全拉取" :description="`从 ${selectedStatus?.upstream} 拉取 ${selectedStatus?.behind || 0} 个提交`" @close="modal = null">
      <div class="confirm-panel"><CloudArrowDown :size="28" /><div><strong>{{ selectedRepository.name }}</strong><p>将执行 fetch 后重新校验状态，并使用 <code>git pull --ff-only</code>。如果工作区不干净、本地有未推送提交或无法 fast-forward，将拒绝拉取。</p></div></div>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="busy" @click="pullCurrent">确认安全拉取</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'more'" title="代码库操作" @close="modal = null">
      <div class="choice-list compact"><button @click="openRepositoryDefaultOpener"><Wrench :size="20" /><div><strong>设置默认打开工具</strong><small>{{ selectedRepository.defaultOpenerId ? `当前为 ${defaultOpener?.name}` : `跟随全局默认：${defaultOpener?.name}` }}</small></div></button><button @click="openRenameRepository"><PencilSimple :size="20" /><div><strong>修改代码库名称</strong><small>只修改索引中的显示名称</small></div></button><button class="danger-choice" @click="modal = 'remove-repository'"><Trash :size="20" /><div><strong>从索引移除代码库</strong><small>不会删除磁盘文件</small></div></button></div>
    </BaseModal>

    <BaseModal v-if="modal === 'remove-repository'" title="移除代码库索引" description="这不会删除磁盘上的任何文件。" @close="modal = null"><div class="danger-summary"><strong>{{ selectedProject.name }}/{{ selectedRepository.name }}</strong><code>{{ selectedRepository.path }}</code></div><template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button danger" @click="removeCurrentRepository">确认移除</button></template></BaseModal>
    <BaseModal v-if="modal === 'remove-project'" title="移除项目索引" description="项目内代码库只会从注册表移除，磁盘文件不会改变。" @close="modal = null"><div class="danger-summary"><strong>{{ selectedProject.name }}</strong><span>{{ selectedProject.repositories.length }} 个代码库</span></div><template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button danger" @click="removeCurrentProject">确认移除</button></template></BaseModal>
  </div>
</template>
