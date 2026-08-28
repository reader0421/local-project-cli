<script setup>
import { computed } from 'vue';
import {
  PhCircleNotch as CircleNotch,
  PhCheckCircle as CheckCircle,
  PhWarningCircle as WarningCircle,
  PhArrowCircleUp as ArrowCircleUp,
  PhXCircle as XCircle,
} from '@phosphor-icons/vue';
import { statusText, statusTone } from '../format.js';

const props = defineProps({ status: { type: Object, default: null }, compact: Boolean });
const tone = computed(() => statusTone(props.status));
const icon = computed(() => ({ loading: CircleNotch, success: CheckCircle, warning: WarningCircle, accent: ArrowCircleUp, danger: XCircle }[tone.value]));
</script>

<template>
  <span class="status-pill" :class="[`tone-${tone}`, { compact }]">
    <component :is="icon" :size="16" :class="{ spin: tone === 'loading' }" />
    <span>{{ statusText(status) }}</span>
  </span>
</template>
