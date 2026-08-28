<script setup>
import { computed, ref } from 'vue';
import {
  PhUploadSimple as UploadSimple,
  PhWarningCircle as WarningCircle,
  PhCheckCircle as CheckCircle,
  PhCloudArrowDown as CloudArrowDown,
  PhArrowClockwise as ArrowClockwise,
  PhCode as Code,
  PhGitBranch as GitBranch,
} from '@phosphor-icons/vue';
import BaseModal from '../components/BaseModal.vue';
import { pushEligibility } from '../format.js';
import { api, repositories, runAction, selectRepository, startScan } from '../store.js';

const modal = ref(null);
const busy = ref(false);
const selected = ref(null);
const results = ref([]);
const candidates = computed(() => repositories.value.filter((item) => item.status?.kind === 'git' && item.status.ahead > 0));
const pushable = computed(() => candidates.value.filter((item) => pushEligibility(item.status).eligible));
const blocked = computed(() => candidates.value.filter((item) => !pushEligibility(item.status).eligible));

function confirmOne(item) { selected.value = item; modal.value = 'single'; }
async function pushOne(item) {
  busy.value = true;
  try {
    await runAction(() => api.pushRepository(item.repository.id), `已推送 ${item.project.name}/${item.repository.name}`);
    modal.value = null;
    await startScan();
  } finally { busy.value = false; }
}

async function pushAll() {
  busy.value = true;
  results.value = [];
  for (const item of pushable.value) {
    try {
      await api.pushRepository(item.repository.id);
      results.value.push({ item, success: true });
    } catch (error) {
      results.value.push({ item, success: false, message: error.message });
    }
  }
  busy.value = false;
  modal.value = 'results';
  await startScan();
}
</script>

<template>
  <div class="page pending-page">
    <header class="page-header">
      <div><p class="eyebrow">SAFE PUSH</p><h1>未推送</h1><p>只推送满足安全条件的已有提交，不处理未提交文件。</p></div>
      <div class="header-actions"><button class="button secondary" @click="startScan({ fetch: true })"><CloudArrowDown :size="18" />获取远端状态</button><button class="button primary" :disabled="!pushable.length" @click="modal = 'all'"><UploadSimple :size="18" />安全推送全部</button></div>
    </header>

    <section class="content-section">
      <div class="section-heading"><div><h2>可安全推送 <span>{{ pushable.length }}</span></h2><p>有 upstream、本地存在待推送提交，且没有分支冲突或进行中的 Git 操作。</p></div><button class="button ghost" @click="startScan()"><ArrowClockwise :size="17" />刷新</button></div>
      <div v-if="pushable.length" class="pending-table">
        <div class="table-head"><span>项目 / 代码库</span><span>分支</span><span>待推送</span><span>最新提交</span><span /></div>
        <div v-for="item in pushable" :key="item.repository.id" class="table-row">
          <button class="repo-cell" @click="selectRepository(item.project.id, item.repository.id)"><strong>{{ item.repository.name }}</strong><small>{{ item.project.name }}</small></button>
          <span class="branch"><GitBranch :size="15" />{{ item.status.branch }}</span>
          <strong class="warning-value">{{ item.status.ahead }} 个提交</strong>
          <div class="commit-cell"><strong>{{ item.status.unpushedCommits?.[0]?.subject || '未读取到提交摘要' }}</strong><small v-if="item.status.ahead > 1">另有 {{ item.status.ahead - 1 }} 条</small></div>
          <button class="button compact primary" @click="confirmOne(item)"><UploadSimple :size="16" />推送</button>
        </div>
      </div>
      <div v-else class="empty-state"><CheckCircle :size="34" /><h3>暂无可安全推送的代码库</h3><p>本地提交全部同步，或者需要先人工处理阻断项。</p></div>
    </section>

    <section v-if="blocked.length" class="content-section blocked-section">
      <div class="section-heading"><div><h2>需要人工处理 <span>{{ blocked.length }}</span></h2><p>Desktop 不会自动 rebase、merge、设置 upstream 或切换分支。</p></div></div>
      <div class="data-list"><button v-for="item in blocked" :key="item.repository.id" class="data-row" @click="selectRepository(item.project.id, item.repository.id)"><WarningCircle :size="21" class="danger-ink" /><div class="row-main"><strong>{{ item.repository.name }}</strong><small>{{ item.project.name }} · {{ item.status.branch }}</small></div><span class="danger-ink">{{ pushEligibility(item.status).reason }}</span></button></div>
    </section>

    <BaseModal v-if="modal === 'single'" title="确认安全推送" :description="`${selected.project.name}/${selected.repository.name}`" @close="modal = null"><div class="confirm-panel"><UploadSimple :size="28" /><div><strong>{{ selected.status.ahead }} 个提交 → {{ selected.status.upstream }}</strong><p v-if="selected.status.dirty">仍有 {{ selected.status.changes.length }} 个未提交修改，本次不会包含。</p><p v-else>当前工作区没有未提交修改。</p></div></div><template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="busy" @click="pushOne(selected)">确认推送</button></template></BaseModal>

    <BaseModal v-if="modal === 'all'" title="批量安全推送确认" description="先核对将推送和将跳过的代码库。" wide @close="modal = null"><div class="push-plan"><section><h3>将推送 · {{ pushable.length }}</h3><div v-for="item in pushable" :key="item.repository.id" class="plan-row"><div><strong>{{ item.project.name }}/{{ item.repository.name }}</strong><small>{{ item.status.branch }}</small></div><span>{{ item.status.ahead }} commits → {{ item.status.upstream }}</span></div></section><section><h3>将跳过 · {{ blocked.length }}</h3><div v-for="item in blocked" :key="item.repository.id" class="plan-row blocked"><div><strong>{{ item.project.name }}/{{ item.repository.name }}</strong><small>{{ item.status.branch }}</small></div><span>{{ pushEligibility(item.status).reason }}</span></div></section></div><template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="busy || !pushable.length" @click="pushAll">确认推送 {{ pushable.length }} 个代码库</button></template></BaseModal>

    <BaseModal v-if="modal === 'results'" title="批量推送结果" @close="modal = null"><div class="result-list"><div v-for="result in results" :key="result.item.repository.id" :class="result.success ? 'success' : 'error'"><CheckCircle v-if="result.success" :size="20" /><WarningCircle v-else :size="20" /><div><strong>{{ result.item.project.name }}/{{ result.item.repository.name }}</strong><small>{{ result.success ? '推送成功' : result.message }}</small></div></div></div><template #footer><button class="button primary" @click="modal = null">完成</button></template></BaseModal>
  </div>
</template>
