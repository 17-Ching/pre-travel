<script setup>
import { nextTick, ref, watch } from 'vue'
import { PhX, PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue'
import { imageBroken } from '../store'

// 點圖放大看原圖。清單詳情與行程抽屜共用，用法：ref 拿到之後呼叫 open(第幾張)。
// 跟 Sheet 同一套原生 <dialog>：focus trap、Esc 都是瀏覽器做的，不裝燈箱套件。
// 疊在行程抽屜（也是 modal dialog）上面也沒問題，top layer 後開的在上面，Esc 只關最上層。
// 掛的是原圖（im.url，上傳時長邊壓到 1600），不用另外抓一張，只是讓它佔滿整個畫面。
//
// 左右滑一樣不寫手勢：整排圖片放進一個 scroll-snap 容器，滑動就是原生捲動，
// 慣性與回彈都免費。「開著沒有」與「現在第幾張」要分成兩個狀態 —— 合成一個的話，
// 滑動更新索引會反過來觸發開啟的 watch，把捲動位置又拉回去。
defineProps({ images: Array, alt: String })
const el = ref()
const rail = ref()
const isOpen = ref(false)
const at = ref(0)
watch(isOpen, async v => {
  if (!v) return el.value?.close()
  el.value?.showModal()
  await nextTick()
  // 直接設 scrollLeft，不用 scrollIntoView：後者會帶平滑動畫，一開啟就看到它自己滑一段
  if (rail.value) rail.value.scrollLeft = at.value * rail.value.clientWidth
}, { flush: 'post' })

function open(i = 0) {
  at.value = i
  isOpen.value = true
}
defineExpose({ open })
const close = () => (isOpen.value = false)

// 點照片旁邊的黑邊關掉，點照片本身不關。
//
// 黑邊是 object-contain 留出來的空白，算在 <img> 自己的框裡面，所以 click.self
// 這類做法分不出來 —— 不管點哪裡，命中的都是那張 <img>。只能自己算：contain 會
// 等比縮到剛好放得下（小圖也會放大），縮放比就是寬高兩個比例取小的那個，
// 再以框的中心往外量實際內容的一半寬高，看點擊位置在不在裡面。
function onClick(e) {
  const im = e.target.closest('img')
  // 沒點到圖片，或圖還沒載好（naturalWidth 為 0，除下去會是 Infinity）
  if (!im?.naturalWidth) return close()
  const r = im.getBoundingClientRect()
  const scale = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight)
  const inside = Math.abs(e.clientX - (r.left + r.width / 2)) <= (im.naturalWidth * scale) / 2
    && Math.abs(e.clientY - (r.top + r.height / 2)) <= (im.naturalHeight * scale) / 2
  if (!inside) close()
}
// 現在滑到第幾張，用捲動位置回推就好，不另外記
const onScroll = e => (at.value = Math.round(e.target.scrollLeft / e.target.clientWidth))
// 桌機翻頁：左右箭頭鈕與鍵盤方向鍵共用。scrollTo 本來就會把超出範圍的值夾回去，
// 但按鈕在頭尾還是要 disabled，不然點了沒反應看起來像壞掉。
const step = d => rail.value?.scrollTo({ left: (at.value + d) * rail.value.clientWidth, behavior: 'smooth' })
</script>

<template>
  <!-- 右上角按鈕、Esc、點畫面任一處都可以關 -->
  <dialog ref="el" class="zoom backdrop:bg-black/95" aria-label="放大檢視"
    @cancel.prevent="close" @click.self="close"
    @keydown.left="step(-1)" @keydown.right="step(1)">
    <!-- 手機滑這條（原生捲動，慣性回彈都免費），桌機用下面的箭頭鈕。
         點黑邊關掉、點照片不關，判斷在 onClick（黑邊算在 <img> 框內，分不掉）-->
    <div ref="rail" class="zoom-rail flex h-full w-full snap-x snap-mandatory" @scroll="onScroll" @click="onClick">
      <img v-for="im in images" :key="im.url" :src="im.url" :alt="alt" draggable="false"
        class="h-full w-full shrink-0 snap-center object-contain" @error="imageBroken(im.url)" />
    </div>

    <!-- 箭頭只給滑鼠，手機用滑的（CSS 的 pointer: coarse 擋掉）。
         .stop 目前不是非要不可（按鈕是 dialog 的直接子層，被 @click.self 擋住了），
         留著是因為哪天有人把按鈕移進捲動容器，就會變成按箭頭順便關掉燈箱 -->
    <template v-if="images.length > 1">
      <button v-for="[d, label, icon] in [[-1, '上一張', PhCaretLeft], [1, '下一張', PhCaretRight]]" :key="d"
        class="zoom-arrow absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition active:scale-90 disabled:opacity-25"
        :class="d < 0 ? 'left-3' : 'right-3'" :aria-label="label"
        :disabled="d < 0 ? at === 0 : at === images.length - 1"
        @click.stop="step(d)">
        <component :is="icon" :size="24" weight="bold" />
      </button>
    </template>
    <button autofocus aria-label="關閉" @click="close"
      class="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition active:scale-90">
      <PhX :size="22" weight="bold" />
    </button>
    <p v-if="images.length > 1" aria-hidden="true"
      class="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-2.5 py-1 text-[13px] tabular-nums text-white backdrop-blur-sm">
      {{ at + 1 }} / {{ images.length }}
    </p>
  </dialog>
</template>
