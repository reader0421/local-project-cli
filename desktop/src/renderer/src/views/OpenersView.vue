<script setup>
import { computed, ref, watch } from 'vue';
import {
  PhWrench as Wrench,
  PhPlus as Plus,
  PhPencilSimple as PencilSimple,
  PhStar as Star,
  PhTrash as Trash,
  PhTerminalWindow as TerminalWindow,
  PhAppWindow as AppWindow,
  PhCommand as Command,
} from '@phosphor-icons/vue';
import BaseModal from '../components/BaseModal.vue';
import { openerKind } from '../format.js';
import { api, repositories, runAction, state } from '../store.js';

const selectedId = ref(state.registry.settings.defaultOpenerId || state.registry.openers[0]?.id);
const modal = ref(null);
const error = ref('');
const form = ref(emptyForm());
const selected = computed(() => state.registry.openers.find((opener) => opener.id === selectedId.value) || state.registry.openers[0]);
const references = computed(() => repositories.value.filter((item) => item.repository.defaultOpenerId === selected.value?.id));

watch(() => state.registry.openers, () => {
  if (!state.registry.openers.some((item) => item.id === selectedId.value)) selectedId.value = state.registry.openers[0]?.id;
}, { deep: true });

function emptyForm() {
  return { id: '', name: '', kind: 'macos-app', application: '', command: '', argsText: '["{path}"]' };
}

function openAdd() { form.value = emptyForm(); error.value = ''; modal.value = 'form'; }
function openEdit() {
  const opener = selected.value;
  const kind = openerKind(opener) === 'macOS 应用' ? 'macos-app' : opener.mode === 'terminal' ? 'terminal' : 'background';
  form.value = {
    id: opener.id,
    name: opener.name,
    kind,
    application: kind === 'macos-app' ? opener.args[1] : '',
    command: kind === 'macos-app' ? '' : opener.command,
    argsText: kind === 'macos-app' ? '["{path}"]' : JSON.stringify(opener.args),
  };
  error.value = '';
  modal.value = 'form';
}

function definition() {
  let args;
  if (form.value.kind === 'macos-app') {
    if (!form.value.application.trim()) throw new Error('请输入应用名称或 .app 路径');
    return { name: form.value.name, command: 'open', args: ['-a', form.value.application.trim(), '{path}'], mode: 'background' };
  }
  try { args = JSON.parse(form.value.argsText); } catch { throw new Error('参数必须是 JSON 字符串数组'); }
  if (!Array.isArray(args) || !args.length || args.some((arg) => typeof arg !== 'string')) throw new Error('参数必须是至少包含一个字符串的数组');
  return { name: form.value.name, command: form.value.command, args, mode: form.value.kind === 'terminal' ? 'terminal' : 'background' };
}

async function save() {
  error.value = '';
  try {
    const input = definition();
    if (state.registry.openers.some((item) => item.id === form.value.id)) await runAction(() => api.updateOpener(form.value.id, input), '打开工具已更新');
    else await runAction(() => api.addOpener({ id: form.value.id, ...input }), '打开工具已添加');
    selectedId.value = form.value.id;
    modal.value = null;
  } catch (cause) { error.value = cause.message; }
}

async function setDefault() { await runAction(() => api.setDefaultOpener(selected.value.id), `${selected.value.name} 已设为默认工具`); }
async function remove() { await runAction(() => api.removeOpener(selected.value.id), `${selected.value.name} 已删除`); modal.value = null; }
</script>

<template>
  <div class="openers-workbench">
    <aside class="opener-list-panel">
      <div class="rail-heading"><div><p class="eyebrow">OPENERS</p><h2>打开工具</h2></div><button class="icon-button" @click="openAdd"><Plus :size="18" /></button></div>
      <p class="rail-copy">列表只用于选择；操作集中在右侧详情。</p>
      <div class="opener-list">
        <button v-for="opener in state.registry.openers" :key="opener.id" :class="{ active: selected?.id === opener.id }" @click="selectedId = opener.id">
          <component :is="opener.mode === 'terminal' ? TerminalWindow : openerKind(opener) === 'macOS 应用' ? AppWindow : Command" :size="22" />
          <div><strong>{{ opener.name }}</strong><small>{{ opener.id }}</small></div>
          <Star v-if="opener.id === state.registry.settings.defaultOpenerId" :size="16" weight="fill" class="accent-ink" />
        </button>
      </div>
    </aside>

    <section v-if="selected" class="opener-detail">
      <header class="page-header compact-header"><div class="repo-title"><Wrench :size="32" /><div><p class="eyebrow">{{ openerKind(selected) }}</p><h1>{{ selected.name }}</h1><p>{{ selected.id }}</p></div></div><div class="header-actions"><button class="button secondary" @click="openEdit"><PencilSimple :size="18" />编辑</button><button v-if="selected.id !== state.registry.settings.defaultOpenerId" class="button primary" @click="setDefault"><Star :size="18" />设为默认</button></div></header>

      <section class="definition-grid">
        <div><span>启动方式</span><strong>{{ openerKind(selected) }}</strong></div>
        <div><span>默认工具</span><strong>{{ selected.id === state.registry.settings.defaultOpenerId ? '是' : '否' }}</strong></div>
        <div class="wide"><span>可执行命令</span><code>{{ selected.command }}</code></div>
        <div class="wide"><span>参数</span><code>{{ JSON.stringify(selected.args) }}</code></div>
      </section>

      <section class="content-section embedded">
        <div class="section-heading"><div><h2>代码库引用 <span>{{ references.length }}</span></h2><p>这些代码库会优先使用该工具打开。</p></div></div>
        <div v-if="references.length" class="data-list"><div v-for="item in references" :key="item.repository.id" class="data-row static"><div class="row-main"><strong>{{ item.repository.name }}</strong><small>{{ item.project.name }}</small></div><span>{{ item.repository.path }}</span></div></div>
        <div v-else class="subtle-empty">当前没有代码库将该工具设为默认。</div>
      </section>

      <div class="danger-zone"><div><strong>删除打开工具</strong><p>只删除注册表配置，不会卸载本机应用。</p></div><button class="button danger" :disabled="selected.id === state.registry.settings.defaultOpenerId || references.length" :title="selected.id === state.registry.settings.defaultOpenerId ? '请先设置其他默认工具' : references.length ? '仍被代码库引用' : ''" @click="modal = 'remove'"><Trash :size="18" />删除</button></div>
    </section>

    <BaseModal v-if="modal === 'form'" :title="state.registry.openers.some((item) => item.id === form.id) ? '编辑打开工具' : '新增打开工具'" wide @close="modal = null">
      <form class="form-stack opener-form" @submit.prevent="save">
        <div class="form-grid"><label>稳定 id<input v-model="form.id" required :disabled="state.registry.openers.some((item) => item.id === form.id)" placeholder="例如 codex-cli" /></label><label>显示名称<input v-model="form.name" required placeholder="例如 Codex CLI" /></label></div>
        <fieldset><legend>启动方式</legend><div class="segmented"><button type="button" :class="{ active: form.kind === 'macos-app' }" @click="form.kind = 'macos-app'"><AppWindow :size="18" />macOS 应用</button><button type="button" :class="{ active: form.kind === 'background' }" @click="form.kind = 'background'"><Command :size="18" />后台命令</button><button type="button" :class="{ active: form.kind === 'terminal' }" @click="form.kind = 'terminal'"><TerminalWindow :size="18" />终端命令</button></div></fieldset>
        <label v-if="form.kind === 'macos-app'">应用名称或 .app 完整路径<input v-model="form.application" required placeholder="/Applications/ChatGPT.app" /><small>将使用 open -a，并把代码库路径作为最后一个参数。</small></label>
        <template v-else><label>可执行命令<input v-model="form.command" required placeholder="例如 codex" /></label><label>参数 JSON 数组<textarea v-model="form.argsText" rows="4" spellcheck="false" /><small><code>{path}</code> 会替换为代码库路径或 openTarget。</small></label></template>
        <p v-if="error" class="form-error">{{ error }}</p>
      </form>
      <template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button primary" :disabled="!form.id.trim() || !form.name.trim()" @click="save">保存</button></template>
    </BaseModal>

    <BaseModal v-if="modal === 'remove'" title="删除打开工具" description="该操作只修改注册表配置。" @close="modal = null"><div class="danger-summary"><strong>{{ selected.name }}</strong><code>{{ selected.id }}</code></div><template #footer><button class="button secondary" @click="modal = null">取消</button><button class="button danger" @click="remove">确认删除</button></template></BaseModal>
  </div>
</template>
