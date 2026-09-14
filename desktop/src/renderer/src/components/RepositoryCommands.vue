<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PhTerminalWindow as TerminalWindow, PhPlus as Plus, PhPencilSimple as Pencil, PhTrash as Trash } from '@phosphor-icons/vue';
import BaseModal from './BaseModal.vue';
import { api, interactionBlocked, runAction, setNotice, state } from '../store.js';

const props = defineProps({ repository: { type: Object, required: true } });
const menu = ref(null);
const modal = ref(null);
const form = ref({ name: '', command: '', id: null });
const saving = ref(false);
const error = ref('');
const returnToManager = ref(false);
const commands = computed(() => props.repository.commands || []);
const terminalName = computed(() => state.registry.settings.defaultTerminalId === 'ghostty' ? 'Ghostty' : 'Terminal');
const ready = computed(() => form.value.name.trim() && form.value.command.trim());
function closeMenu() { if (menu.value) menu.value.open = false; }
function outside(event) { if (!menu.value?.contains(event.target)) closeMenu(); }
function escape(event) { if (event.key === 'Escape') closeMenu(); }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });
watch(() => props.repository.id, () => { closeMenu(); modal.value = null; });
function openManager() { closeMenu(); modal.value = 'manage'; error.value = ''; }
defineExpose({ openManager });
function edit(item = null) {
  returnToManager.value = modal.value === 'manage';
  closeMenu();
  form.value = item ? { ...item } : { name: '', command: '', id: null };
  error.value = '';
  modal.value = 'edit';
}
function close() {
  if (saving.value) return;
  error.value = '';
  modal.value = modal.value === 'edit' && returnToManager.value ? 'manage' : null;
}
async function save() {
  if (saving.value || !ready.value) return;
  saving.value = true;
  error.value = '';
  try {
    await runAction(() => api.saveRepositoryCommand(props.repository.id, { name: form.value.name, command: form.value.command }, form.value.id || undefined), '自定义命令已保存');
    modal.value = returnToManager.value ? 'manage' : null;
  } catch (cause) { error.value = String(cause.message || cause); }
  finally { saving.value = false; }
}
function confirmRemove(item) { form.value = { ...item }; error.value = ''; modal.value = 'remove'; }
async function remove() {
  if (saving.value) return;
  saving.value = true;
  try {
    await runAction(() => api.removeRepositoryCommand(props.repository.id, form.value.id), '自定义命令已删除');
    modal.value = 'manage';
  } catch (cause) { error.value = String(cause.message || cause); }
  finally { saving.value = false; }
}
async function run(item) {
  closeMenu();
  try {
    const result = await runAction(() => api.runRepositoryCommand(props.repository.id, item.id), null, {
      title: '正在打开终端', detail: `${props.repository.name} / ${item.name}：正在交给 ${terminalName.value} 执行。`,
    });
    if (result) setNotice('success', `已交给 ${result.terminalName}，请在终端查看输出`);
  } catch { /* runAction 已显示启动错误。 */ }
}
</script>

<template>
  <details ref="menu" class="repository-command-menu">
    <summary class="button secondary"><TerminalWindow :size="19" />运行命令</summary>
    <div class="command-dropdown">
      <button class="command-add" @click="edit()"><Plus :size="18" />增加命令</button>
      <div class="command-dropdown-list">
        <button v-for="item in commands" :key="item.id" @click="run(item)"><strong>{{ item.name }}</strong><code>{{ item.command }}</code></button>
        <p v-if="!commands.length">还没有命令，点击上方增加。</p>
      </div>
      <small>在代码库根目录使用 {{ terminalName }} 运行</small>
    </div>
  </details>
  <Teleport to="body">
    <div :inert="interactionBlocked">
      <BaseModal v-if="modal === 'manage'" title="自定义命令管理" :description="repository.name" @close="close">
        <button class="button secondary" @click="edit()"><Plus :size="18" />增加命令</button>
        <div class="command-management-list">
          <div v-for="item in commands" :key="item.id" class="command-management-row">
            <div><strong>{{ item.name }}</strong><code>{{ item.command }}</code></div>
            <button class="icon-button" :aria-label="`编辑 ${item.name}`" @click="edit(item)"><Pencil :size="18" /></button>
            <button class="icon-button danger-text" :aria-label="`删除 ${item.name}`" @click="confirmRemove(item)"><Trash :size="18" /></button>
          </div>
          <p v-if="!commands.length" class="subtle-empty">暂无自定义命令，例如 pnpm dev、pnpm build。</p>
        </div>
        <template #footer><button class="button secondary" @click="close">关闭</button></template>
      </BaseModal>
      <BaseModal v-if="modal === 'edit'" :title="form.id ? '编辑命令' : '增加命令'" :description="repository.name" @close="close">
        <form id="repository-command-form" class="form-stack" @submit.prevent="save">
          <label>命令名称<input v-model="form.name" maxlength="100" required autofocus placeholder="例如：启动开发服务" :disabled="saving" /></label>
          <label>执行命令<textarea v-model="form.command" rows="5" maxlength="16000" required placeholder="例如：pnpm dev" :disabled="saving" spellcheck="false" /></label>
          <small>工作目录：{{ repository.path }}<br />使用 {{ terminalName }} 运行，输出保留在终端窗口。</small>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </form>
        <template #footer><button class="button secondary" :disabled="saving" @click="close">取消</button><button class="button primary" type="submit" form="repository-command-form" :disabled="saving || !ready">{{ saving ? '保存中…' : '保存' }}</button></template>
      </BaseModal>
      <BaseModal v-if="modal === 'remove'" title="删除自定义命令" @close="saving || (modal = 'manage')">
        <p>删除“{{ form.name }}”？这只会移除保存的命令，不会停止已运行的进程。</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <template #footer><button class="button secondary" :disabled="saving" @click="modal = 'manage'">取消</button><button class="button danger" :disabled="saving" @click="remove">{{ saving ? '删除中…' : '确认删除' }}</button></template>
      </BaseModal>
    </div>
  </Teleport>
</template>
