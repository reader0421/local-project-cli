<script setup>
import { PhX as X } from '@phosphor-icons/vue';

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  wide: Boolean,
  extraWide: Boolean,
});
const emit = defineEmits(['close']);
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <section class="modal" :class="{ 'modal-wide': wide, 'modal-extra-wide': extraWide }" role="dialog" aria-modal="true" :aria-label="title">
      <header class="modal-header">
        <div>
          <h2>{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
        <button class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
      </header>
      <div class="modal-body"><slot /></div>
      <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
    </section>
  </div>
</template>
