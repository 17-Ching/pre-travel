<script setup>
import { ref, watch, useSlots } from 'vue'
// Bottom sheet on the native <dialog>. ponytail: no animation lib — 進出場用 CSS
// @starting-style + allow-discrete（結構與動畫在 style.css 的 .sheet），
// focus trap 與 Esc 交給瀏覽器。
const props = defineProps({ open: Boolean, title: String })
const emit = defineEmits(['update:open'])
const slots = useSlots()
const el = ref()
watch(() => props.open, v => (v ? el.value?.showModal() : el.value?.close()), { flush: 'post' })
// State lives in the parent; Esc (cancel) and backdrop click just ask the parent to close.
const close = () => emit('update:open', false)
</script>

<template>
  <dialog ref="el" class="sheet rounded-t-[20px] bg-card text-ink shadow-e2 backdrop:bg-black/45 backdrop:backdrop-blur-[2px]"
    @cancel.prevent="close" @click.self="close">
    <div :class="['sheet-scroll px-3 pt-2.5', !slots.footer && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]']">
      <div class="mx-auto mb-2 h-1 w-9 rounded-full bg-line" aria-hidden="true" />
      <h2 v-if="title" class="mb-1 px-3 pt-1 text-[13px] font-medium tracking-wide text-muted">{{ title }}</h2>
      <slot />
    </div>
    <div v-if="slots.footer" class="shrink-0 border-t border-line px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
      <slot name="footer" />
    </div>
  </dialog>
</template>
