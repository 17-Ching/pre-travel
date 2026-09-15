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
    <!-- autofocus 放在捲動容器上，是為了「不要」把焦點交給第一個輸入框：
         showModal() 預設會聚焦第一個可聚焦元素，在手機上等於一打開抽屜鍵盤就跳出來，
         把面板整個往上頂。焦點留在這個 tabindex="-1" 的容器，鍵盤等使用者點輸入框才開，
         方向鍵也還能捲動抽屜內容。 -->
    <div tabindex="-1" autofocus
      :class="['sheet-scroll px-3 pt-2.5 focus:outline-none', !slots.footer && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]']">
      <div class="mx-auto mb-2 h-1 w-9 rounded-full bg-line" aria-hidden="true" />
      <h2 v-if="title" class="mb-1 px-3 pt-1 text-[13px] font-medium tracking-wide text-muted">{{ title }}</h2>
      <slot />
    </div>
    <div v-if="slots.footer" class="shrink-0 border-t border-line px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
      <slot name="footer" />
    </div>
  </dialog>
</template>
