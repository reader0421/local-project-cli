<script setup>
import { computed } from 'vue';
import {
  PhDatabase as Database,
  PhCopy as Copy,
  PhFolderOpen as FolderOpen,
  PhArrowClockwise as ArrowClockwise,
  PhWrench as Wrench,
  PhInfo as Info,
  PhGithubLogo as GithubLogo,
} from '@phosphor-icons/vue';
import { api, runAction, startScan, state } from '../store.js';

const defaultOpener = computed(() => state.registry.openers.find((item) => item.id === state.registry.settings.defaultOpenerId));

async function chooseRegistry() {
  const response = await runAction(() => api.chooseRegistry(), '注册表已切换');
  if (response) {
    state.registry = response.registry;
    state.registryPath = response.registryPath;
    await startScan();
  }
}

async function changeDefault(event) {
  await runAction(() => api.setDefaultOpener(event.target.value), '默认打开工具已修改');
}
</script>

<template>
  <div class="page settings-page">
    <header class="page-header"><div><p class="eyebrow">PREFERENCES</p><h1>设置</h1><p>Desktop 和 npm CLI 独立更新，只共享兼容的注册表数据。</p></div></header>

    <section class="settings-section">
      <div class="settings-title"><Database :size="24" /><div><h2>注册表</h2><p>项目、代码库和 opener 的唯一持久化文件。</p></div></div>
      <div class="settings-card">
        <div class="setting-row"><div><span>当前路径</span><code>{{ state.registryPath }}</code></div><div class="row-actions"><button class="icon-button" title="复制路径" @click="api.copyRegistryPath"><Copy :size="18" /></button><button class="icon-button" title="在 Finder 中显示" @click="api.showRegistry"><FolderOpen :size="18" /></button></div></div>
        <div class="setting-row"><div><span>Schema 版本</span><strong>{{ state.schemaVersion }}</strong></div><span class="compatibility">兼容</span></div>
        <div class="setting-row"><div><span>自定义注册表</span><p>切换前会验证目标 JSON；失败时保留当前配置。</p></div><button class="button secondary" @click="chooseRegistry">选择文件</button></div>
        <div class="setting-row"><div><span>重新读取</span><p>获取 CLI 或其他 Desktop 实例写入的最新内容。</p></div><button class="button secondary" @click="startScan()"><ArrowClockwise :size="17" />重新读取</button></div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-title"><Wrench :size="24" /><div><h2>默认打开工具</h2><p>代码库没有上次选择时使用该工具。</p></div></div>
      <div class="settings-card"><div class="setting-row"><div><span>当前默认</span><strong>{{ defaultOpener?.name }}</strong><small>{{ defaultOpener?.id }}</small></div><select :value="state.registry.settings.defaultOpenerId" @change="changeDefault"><option v-for="opener in state.registry.openers" :key="opener.id" :value="opener.id">{{ opener.name }}</option></select></div><div class="setting-row"><div><span>管理工具定义</span><p>新增、编辑、引用保护和删除在“打开工具”页面完成。</p></div><button class="button secondary" @click="state.navigation = 'openers'">前往管理</button></div></div>
    </section>

    <section class="settings-section">
      <div class="settings-title"><Info :size="24" /><div><h2>版本与更新边界</h2><p>两个发行渠道互不安装、覆盖或升级对方。</p></div></div>
      <div class="settings-card"><div class="setting-row"><div><span>LocalProject</span><strong>v{{ state.desktopVersion }}</strong></div><span>GitHub Release</span></div><div class="setting-row"><div><span>共享 Core</span><strong>Schema {{ state.schemaVersion }}</strong></div><span>内置于 Desktop</span></div><div class="setting-row"><div><span>Local Project CLI</span><code>npm update -g local-project-cli</code></div><span>npm 独立更新</span></div><a class="setting-row link-row" href="https://github.com/reader0421/local-project-cli/releases?q=desktop-v&amp;expanded=true" target="_blank"><div><GithubLogo :size="20" /><strong>查看桌面版本与更新</strong></div><span>desktop-v*</span></a><a class="setting-row link-row" href="https://github.com/reader0421/local-project-cli" target="_blank"><div><GithubLogo :size="20" /><strong>查看 GitHub 仓库</strong></div><span>reader0421/local-project-cli</span></a></div>
    </section>
  </div>
</template>
