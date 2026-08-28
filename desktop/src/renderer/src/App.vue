<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import {
  PhChartDonut as ChartDonut,
  PhFolder as Folder,
  PhUploadSimple as UploadSimple,
  PhWrench as Wrench,
  PhGear as Gear,
  PhCircleNotch as CircleNotch,
  PhCheckCircle as CheckCircle,
  PhArrowClockwise as ArrowClockwise,
  PhWarningCircle as WarningCircle,
} from '@phosphor-icons/vue';
import { initialize, startScan, state, unpushedRepositories } from './store.js';
import OverviewView from './views/OverviewView.vue';
import ProjectsView from './views/ProjectsView.vue';
import PendingView from './views/PendingView.vue';
import OpenersView from './views/OpenersView.vue';
import SettingsView from './views/SettingsView.vue';

let removeProgressListener;
onMounted(async () => { removeProgressListener = await initialize(); });
onBeforeUnmount(() => removeProgressListener?.());

const navigation = [
  { id: 'overview', label: '概览', icon: ChartDonut },
  { id: 'projects', label: '项目', icon: Folder },
  { id: 'pending', label: '未推送', icon: UploadSimple },
  { id: 'openers', label: '打开工具', icon: Wrench },
  { id: 'settings', label: '设置', icon: Gear },
];

const currentView = computed(() => ({
  overview: OverviewView,
  projects: ProjectsView,
  pending: PendingView,
  openers: OpenersView,
  settings: SettingsView,
}[state.navigation] || ProjectsView));

const lastScanLabel = computed(() => {
  if (!state.lastScanCompletedAt) return '尚未更新';
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(state.lastScanCompletedAt));
  return `上次更新 ${time}`;
});
</script>

<template>
  <main class="app-shell">
    <header class="titlebar">
      <div class="titlebar-drag" />
      <strong>LocalProject</strong>
      <div class="scan-indicator" :class="{ active: state.scanning }">
        <CircleNotch v-if="state.scanning" :size="17" class="spin" />
        <CheckCircle v-else :size="17" />
        <span v-if="state.scanning">正在更新 Git 状态…</span>
        <span v-else>{{ lastScanLabel }}</span>
        <small v-if="state.scanProgress.total">{{ state.scanProgress.completed }}/{{ state.scanProgress.total }}</small>
        <button
          class="scan-refresh"
          type="button"
          title="刷新 Git 状态"
          aria-label="刷新 Git 状态"
          :disabled="state.scanning"
          @click="startScan()"
        >
          <ArrowClockwise :size="17" :class="{ spin: state.scanning }" />
        </button>
      </div>
    </header>

    <aside class="sidebar">
      <nav>
        <button
          v-for="item in navigation"
          :key="item.id"
          class="nav-item"
          :class="{ active: state.navigation === item.id }"
          @click="state.navigation = item.id"
        >
          <component :is="item.icon" :size="22" />
          <span>{{ item.label }}</span>
          <span v-if="item.id === 'pending' && unpushedRepositories.length" class="nav-badge">{{ unpushedRepositories.length }}</span>
        </button>
      </nav>
    </aside>

    <section class="workspace">
      <div v-if="state.loading" class="center-state">
        <CircleNotch :size="28" class="spin" />
        <strong>正在读取本机项目…</strong>
      </div>
      <component :is="currentView" v-else />
    </section>

    <Transition name="toast">
      <div v-if="state.notice" class="toast" :class="state.notice.kind">
        <CheckCircle v-if="state.notice.kind === 'success'" :size="20" />
        <WarningCircle v-else :size="20" />
        <span>{{ state.notice.message }}</span>
      </div>
    </Transition>
  </main>
</template>
