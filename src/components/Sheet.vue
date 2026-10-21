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

// 手機往下滑關閉。只接 touch 事件，桌機滑鼠不受影響。
// 內容捲到最上面才接手：還捲在中間時手指往下是在捲內容，不是要關。
// 先看前幾 px 的方向再決定 —— 往上或橫向（照片列、日期列）就整段放給原生捲動。
// 拖的時候直接改 inline translate、關掉 transition 讓面板跟手；放開時把 inline 清掉，
// CSS 原本的進退場 transition 自然接手：沒過門檻就彈回 0，過了就從當下位置滑出去。
let startX = 0, startY = 0, startT = 0, dy = 0, tracking = false, decided = false
function onTouchStart(e) {
  if (e.touches.length !== 1 || e.target.closest('textarea, select')) return
  if (el.value.querySelector('.sheet-scroll').scrollTop > 0) return
  const t = e.touches[0]
  startX = t.clientX; startY = t.clientY; startT = Date.now()
  dy = 0; tracking = true; decided = false
}
function onTouchMove(e) {
  if (!tracking) return
  const t = e.touches[0]
  const x = t.clientX - startX, y = t.clientY - startY
  if (!decided) {
    if (Math.abs(x) < 6 && Math.abs(y) < 6) return
    decided = true
    if (y <= 0 || Math.abs(x) > Math.abs(y)) { tracking = false; return }
  }
  e.preventDefault()   // 不讓內容跟著捲，也不要觸發瀏覽器的下拉重新整理
  dy = Math.max(0, y)
  el.value.style.transition = 'none'
  el.value.style.translate = `0 ${dy}px`
}
function onTouchEnd() {
  if (!tracking) return
  tracking = false
  if (!decided) return
  // 拖超過 120px，或快速往下甩一下，就關
  const flick = dy > 30 && dy / Math.max(1, Date.now() - startT) > 0.5
  el.value.style.transition = ''
  el.value.style.translate = ''
  if (dy > 120 || flick) close()
}
</script>

<template>
  <dialog ref="el" class="sheet rounded-t-[20px] bg-card text-ink shadow-e2 backdrop:bg-black/45 backdrop:backdrop-blur-[2px]"
    @cancel.prevent="close" @click.self="close"
    @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd">
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
