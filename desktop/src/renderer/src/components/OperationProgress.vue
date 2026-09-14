<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { PhCircleNotch as CircleNotch } from '@phosphor-icons/vue';
import { interactionBlocked, state } from '../store.js';

const now = ref(Date.now());
const timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => window.clearInterval(timer));
const operation = computed(() => state.operation || (state.scanning ? {
  title: state.scanFetch ? '正在获取远端并更新差异' : '正在刷新本地 Git 状态',
  detail: state.scanFetch ? '正在连接远端仓库、获取提交信息，再比较本地与远端分支。' : '正在逐个读取代码库的分支、工作区和提交状态。',
  startedAt: state.scanStartedAt,
  ...state.scanProgress,
} : null));
const elapsed = computed(() => Math.max(0, Math.floor((now.value - operation.value.startedAt) / 1000)));
</script>

<template>
  <Teleport to="body">
    <div v-if="operation" :class="interactionBlocked ? 'operation-backdrop' : 'operation-background'">
      <section class="operation-card" role="status" aria-live="polite" aria-atomic="true">
        <CircleNotch :size="36" class="spin operation-spinner" />
        <h2>{{ operation.title }}</h2>
        <p>{{ operation.detail }}</p>
        <template v-if="operation.total > 0">
          <progress :value="operation.completed" :max="operation.total" aria-label="代码库处理进度" />
          <strong>{{ operation.completed }} / {{ operation.total }} 个代码库已完成</strong>
        </template>
        <progress v-else aria-label="操作进行中" />
        <small aria-live="off">已等待 {{ elapsed }} 秒{{ elapsed >= 15 ? ' · 操作仍在执行，请稍候' : '' }}</small>
        <small v-if="interactionBlocked">请勿重复操作，完成后将自动返回。</small>
      </section>
    </div>
  </Teleport>
</template>
