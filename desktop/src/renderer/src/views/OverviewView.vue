<script setup>
import { computed, ref } from 'vue';
import {
  PhFolder as Folder,
  PhGitBranch as GitBranch,
  PhPencilSimple as PencilSimple,
  PhUploadSimple as UploadSimple,
  PhArrowClockwise as ArrowClockwise,
  PhCloudArrowDown as CloudArrowDown,
  PhPlus as Plus,
  PhCheckCircle as CheckCircle,
} from '@phosphor-icons/vue';
import { projects, repositories, selectRepository, startScan, state } from '../store.js';
import StatusPill from '../components/StatusPill.vue';
import BaseModal from '../components/BaseModal.vue';
import { api, runAction } from '../store.js';

const showAdd = ref(false);
const form = ref({ name: '', workspacePath: '' });
const dirty = computed(() => repositories.value.filter((item) => item.status?.dirty));
const unpushed = computed(() => repositories.value.filter((item) => item.status?.ahead > 0));
const attention = computed(() => repositories.value.filter((item) => {
  const status = item.status;
  return status && (status.kind !== 'git' || status.dirty || status.ahead > 0 || status.behind > 0 || !status.upstream || status.detached || status.operation);
}));

async function addProject() {
  await runAction(() => api.addProject({ name: form.value.name, workspacePath: form.value.workspacePath || undefined }), '项目已添加');
  showAdd.value = false;
  form.value = { name: '', workspacePath: '' };
  await startScan();
}
</script>

<template>
  <div class="page overview-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">WORKSPACE HEALTH</p>
        <h1>概览</h1>
        <p>快速确认本机项目状态，以及今天还需要处理的工作。</p>
      </div>
      <div class="header-actions">
        <button class="button secondary" @click="startScan({ fetch: true })"><CloudArrowDown :size="18" />获取远端状态</button>
        <button class="button primary" @click="showAdd = true"><Plus :size="18" />添加项目</button>
      </div>
    </header>

    <section class="metric-grid">
      <article class="metric"><Folder :size="23" /><strong>{{ projects.length }}</strong><span>项目</span></article>
      <article class="metric"><GitBranch :size="23" /><strong>{{ repositories.length }}</strong><span>代码库</span></article>
      <article class="metric danger"><PencilSimple :size="23" /><strong>{{ dirty.length }}</strong><span>代码库有未提交修改</span></article>
      <article class="metric warning"><UploadSimple :size="23" /><strong>{{ unpushed.length }}</strong><span>代码库有未推送提交</span></article>
    </section>

    <section class="content-section attention-section">
      <div class="section-heading">
        <div><h2>需要处理</h2><p>Git 异常、未提交修改、未推送提交和需要人工确认的代码库。</p></div>
        <button class="button ghost" @click="startScan()"><ArrowClockwise :size="17" />刷新</button>
      </div>
      <div v-if="attention.length" class="attention-grid">
        <button v-for="item in attention" :key="item.repository.id" class="attention-card" @click="selectRepository(item.project.id, item.repository.id)">
          <div class="attention-card-heading"><div><strong>{{ item.repository.name }}</strong><small>{{ item.project.name }}</small></div><GitBranch :size="18" /></div>
          <div class="attention-card-branch"><span>当前分支</span><code>{{ item.status?.branch || '无分支' }}</code></div>
          <StatusPill :status="item.status" />
        </button>
      </div>
      <div v-else class="empty-state"><CheckCircle :size="34" /><h3>当前无需处理</h3><p>已登记的代码库状态正常。</p></div>
    </section>

    <BaseModal v-if="showAdd" title="添加项目" description="项目用于组织一组相关代码库。" @close="showAdd = false">
      <form class="form-stack" @submit.prevent="addProject">
        <label>项目名称<input v-model="form.name" required autofocus placeholder="例如 Local Project" /></label>
        <label>Workspace 路径（可选）<input v-model="form.workspacePath" placeholder="/path/to/project.code-workspace" /></label>
      </form>
      <template #footer><button class="button secondary" @click="showAdd = false">取消</button><button class="button primary" :disabled="!form.name.trim()" @click="addProject">添加项目</button></template>
    </BaseModal>
  </div>
</template>
