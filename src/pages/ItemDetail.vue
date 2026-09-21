<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPencilSimple, PhTrash, PhCopy, PhArrowSquareOut, PhCheck, PhMapPin, PhShoppingBag, PhX, PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue'
import { store, item as getItem, user, setStatus, deleteItem, copyItem, toast, fmtDateTime, linkLabel, sourceLabel, imageOk, imageBroken, ART } from '../store'
import TopBar from '../components/TopBar.vue'
import Avatar from '../components/Avatar.vue'
import TagChip from '../components/TagChip.vue'
import Sheet from '../components/Sheet.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const it = computed(() => getItem(route.params.itemId))
if (!it.value) router.replace(`/trips/${tripId}`)

const editable = computed(() => it.value.ownerUserId === store.me)
const images = computed(() => it.value.images ?? [])
const region = computed(() => store.regions.find(r => r.id === it.value.regionId)?.name)
const tags = computed(() => it.value.tagIds.map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean))
const links = computed(() => it.value.links ?? [])
const copying = ref(false)

// 圖片橫滑：手機用手指滑，滑鼠沒有對應動作 —— 捲軸被藏起來了，桌機既拖不動
// 也看不出來還有第二張。這裡自己接滑鼠拖曳。
//
// 只認滑鼠（pointerType === 'mouse'）：觸控本身就有慣性與回彈，接手反而更難用。
// 拖曳期間要把 scroll-snap 關掉，不然每移動一點就被吸回去；放開才還原，
// 這樣手一鬆會自己對齊到最近那張。
//
// 燈箱裡不用這一套：那邊桌機走左右箭頭鈕，手機走原生捲動，都不需要接滑鼠拖曳。
const rail = ref()
const dragging = ref(false)
let startX = 0, startLeft = 0, dragged = false

function dragStart(e) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  dragging.value = true
  dragged = false
  startX = e.clientX
  startLeft = rail.value.scrollLeft
}
// 位移超過門檻才算真的在拖，這時候才抓 pointer capture。
//
// 不能在 pointerdown 就抓：capture 期間 pointerup 也算在軌道身上，瀏覽器就把
// click 派給軌道而不是圖片，圖片自己的 @click 永遠不會跑 —— 點圖放大一開始
// 就是這樣壞掉的，而且從程式上看不出來，因為 handler 明明掛在 <img> 上。
// 改成移動後才抓，單純點一下的全程沒有 capture，click 就正常落在圖片上。
//
// dragged 同時擋掉「拖完那一下補發的 click」，不然桌機每拖一次看下一張都會彈出燈箱。
// 每次 pointerdown 都重設，所以拖曳結束後的 click 沒落在圖片上也不會卡住下一次點擊。
function dragMove(e) {
  if (!dragging.value || Math.abs(e.clientX - startX) <= 4) return
  if (!dragged) { dragged = true; rail.value.setPointerCapture(e.pointerId) }
  rail.value.scrollLeft = startLeft - (e.clientX - startX)
}
function dragEnd(e) {
  if (!dragging.value) return
  dragging.value = false
  if (dragged) rail.value.releasePointerCapture?.(e.pointerId)
}

// 點圖放大看原圖。跟 Sheet 同一套原生 <dialog>：focus trap、Esc 都是瀏覽器做的，
// 不裝燈箱套件。軌道上掛的本來就是原圖（im.url，上傳時長邊壓到 1600），
// 所以這裡不用另外抓一張，只是讓它佔滿整個畫面。
//
// 燈箱裡的左右滑一樣不寫手勢：整排圖片放進一個 scroll-snap 容器，滑動就是原生捲動，
// 慣性與回彈都免費。「開著沒有」與「現在第幾張」要分成兩個狀態 —— 合成一個的話，
// 滑動更新索引會反過來觸發開啟的 watch，把捲動位置又拉回去。
const zoomEl = ref()
const zoomRail = ref()
const zoomOpen = ref(false)
const zoomAt = ref(0)
watch(zoomOpen, async v => {
  if (!v) return zoomEl.value?.close()
  zoomEl.value?.showModal()
  await nextTick()
  // 直接設 scrollLeft，不用 scrollIntoView：後者會帶平滑動畫，一開啟就看到它自己滑一段
  if (zoomRail.value) zoomRail.value.scrollLeft = zoomAt.value * zoomRail.value.clientWidth
}, { flush: 'post' })

function openZoom(i) {
  if (dragged) return
  zoomAt.value = i
  zoomOpen.value = true
}
const closeZoom = () => (zoomOpen.value = false)

// 點照片旁邊的黑邊關掉，點照片本身不關。
//
// 黑邊是 object-contain 留出來的空白，算在 <img> 自己的框裡面，所以 click.self
// 這類做法分不出來 —— 不管點哪裡，命中的都是那張 <img>。只能自己算：contain 會
// 等比縮到剛好放得下（小圖也會放大），縮放比就是寬高兩個比例取小的那個，
// 再以框的中心往外量實際內容的一半寬高，看點擊位置在不在裡面。
function onZoomClick(e) {
  const im = e.target.closest('img')
  // 沒點到圖片，或圖還沒載好（naturalWidth 為 0，除下去會是 Infinity）
  if (!im?.naturalWidth) return closeZoom()
  const r = im.getBoundingClientRect()
  const scale = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight)
  const inside = Math.abs(e.clientX - (r.left + r.width / 2)) <= (im.naturalWidth * scale) / 2
    && Math.abs(e.clientY - (r.top + r.height / 2)) <= (im.naturalHeight * scale) / 2
  if (!inside) closeZoom()
}
// 現在滑到第幾張，用捲動位置回推就好，不另外記
const onZoomScroll = e => (zoomAt.value = Math.round(e.target.scrollLeft / e.target.clientWidth))
// 桌機翻頁：左右箭頭鈕與鍵盤方向鍵共用。scrollTo 本來就會把超出範圍的值夾回去，
// 但按鈕在頭尾還是要 disabled，不然點了沒反應看起來像壞掉。
const zoomStep = d => zoomRail.value?.scrollTo({ left: (zoomAt.value + d) * zoomRail.value.clientWidth, behavior: 'smooth' })

// F-30: plain text with URLs turned into links. Escape first, then linkify.
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener" class="break-all text-accent underline">${u}</a>`)

function remove() {
  if (confirm(`刪除「${it.value.title}」？`)) { deleteItem(it.value.id); router.replace(`/trips/${tripId}`) }
}
// v2.0：共同分頁移除（Q8），複製目標只剩自己的願望清單
function copy() {
  copyItem(it.value); copying.value = false
  toast('已複製到我的清單', { label: '前往', to: { path: `/trips/${tripId}`, query: { tab: 'list', who: 'me' } } })
}
const STATUS = [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']]
</script>

<template>
  <template v-if="it">
    <TopBar :title="it.type === 'place' ? '地點' : '購物'" back>
      <button class="icon-btn" aria-label="複製到…" @click="copying = true"><PhCopy :size="22" /></button>
      <template v-if="editable && !store.offline">
        <RouterLink :to="`/trips/${tripId}/items/${it.id}/edit`" class="icon-btn" aria-label="編輯"><PhPencilSimple :size="22" /></RouterLink>
        <button class="icon-btn text-danger" aria-label="刪除" @click="remove"><PhTrash :size="22" /></button>
      </template>
    </TopBar>

    <main class="pb-12">
      <!-- 滑鼠可以直接拖。dragstart.prevent 是必要的：不擋的話拖 <img> 會變成
           瀏覽器原生的拖曳圖片，捲動就中斷了 -->
      <div v-if="images.length" ref="rail"
        :class="['rail flex snap-x snap-mandatory gap-2', images.length > 1 && (dragging ? 'cursor-grabbing' : 'cursor-grab')]"
        :style="dragging ? 'scroll-snap-type: none; user-select: none' : ''"
        @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd" @dragstart.prevent>
        <!-- 載不到的那張換成佔位，不要整條軌道少一格：少一格會讓後面的圖片全部往前位移，
             使用者以為照片被刪了。佔位圖示跟列表卡片同一組 -->
        <template v-for="(im, i) in images" :key="im.url">
          <img v-if="imageOk(im.url)" :src="im.url" alt="" draggable="false" @error="imageBroken(im.url)"
            role="button" tabindex="0" :aria-label="`放大第 ${i + 1} 張照片`"
            @click="openZoom(i)" @keydown.enter.prevent="openZoom(i)" @keydown.space.prevent="openZoom(i)"
            :class="['aspect-[4/3] shrink-0 snap-center rounded-xl bg-line object-cover', images.length > 1 ? 'w-[85%]' : 'w-full cursor-zoom-in']" />
          <div v-else :class="['flex aspect-[4/3] shrink-0 snap-center items-center justify-center rounded-xl bg-tint-soft text-tint', images.length > 1 ? 'w-[85%]' : 'w-full']">
            <img v-if="imageOk(ART[it.type])" :src="ART[it.type]" alt="" class="w-[42%] max-w-[180px] object-contain" @error="imageBroken(ART[it.type])" />
            <component v-else :is="it.type === 'place' ? PhMapPin : PhShoppingBag" :size="44" />
          </div>
        </template>
      </div>

      <div class="px-4 pt-4">
        <h1 :class="['text-[22px] font-semibold leading-tight', it.status === 'bought' && 'text-muted line-through']">{{ it.title }}</h1>

        <div v-if="links.length" class="mt-4 grid gap-2">
          <a v-for="l in links" :key="l.id" :href="l.url" target="_blank" rel="noopener" class="btn-ghost w-full justify-start gap-2.5">
            <PhArrowSquareOut :size="18" class="shrink-0 text-accent" />
            <span class="min-w-0 flex-1 truncate text-left">{{ linkLabel(l) }}</span>
            <span v-if="l.title?.trim()" class="shrink-0 text-[13px] font-normal text-muted">{{ sourceLabel(l.url) }}</span>
          </a>
        </div>

        <dl class="mt-5 grid gap-3 text-[15px]">
          <div v-if="region" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">地區</dt><dd>{{ region }}</dd></div>
          <div v-if="tags.length" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">標籤</dt><dd class="flex flex-wrap gap-1"><TagChip v-for="n in tags" :key="n" :name="n" /></dd></div>
          <div v-if="it.type === 'shopping' && it.plannedStore" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">預計購買</dt><dd>{{ it.plannedStore }}</dd></div>
          <div class="flex items-center gap-4">
            <dt class="w-20 shrink-0 text-muted">{{ it.type === 'shopping' ? '狀態' : '去過了嗎' }}</dt>
            <dd>
              <div v-if="it.type === 'shopping'" class="flex gap-1.5">
                <button v-for="[k, l] in STATUS" :key="k" :disabled="!editable" @click="setStatus(it, { status: k })"
                  :class="['h-8 rounded-full border px-3 text-[13px] font-medium', it.status === k ? 'border-ink bg-ink text-surface' : 'border-line text-muted']">{{ l }}</button>
              </div>
              <button v-else :disabled="!editable" @click="setStatus(it, { visited: !it.visited })"
                :class="['flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium', it.visited ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted']">
                <PhCheck :size="14" weight="bold" />{{ it.visited ? '已去過' : '還沒去' }}
              </button>
            </dd>
          </div>
        </dl>

        <p v-if="it.note" class="mt-5 whitespace-pre-line text-[15px] leading-relaxed" v-html="linkify(it.note)" />

        <p class="mt-6 flex items-center gap-1.5 text-[13px] text-muted">
          <Avatar :user="user(it.createdBy)" :size="18" />{{ user(it.createdBy)?.name }} 於 {{ fmtDateTime(it.createdAt) }} 新增
        </p>
      </div>
    </main>

    <Sheet v-model:open="copying" title="複製到…">
      <button class="row" :disabled="it.ownerUserId === store.me" @click="copy">我的分頁</button>
    </Sheet>

    <!-- 放大看原圖。右上角按鈕、Esc、點畫面任一處都可以關 -->
    <dialog ref="zoomEl" class="zoom backdrop:bg-black/95" aria-label="放大檢視"
      @cancel.prevent="closeZoom" @click.self="closeZoom"
      @keydown.left="zoomStep(-1)" @keydown.right="zoomStep(1)">
      <!-- 手機滑這條（原生捲動，慣性回彈都免費），桌機用下面的箭頭鈕。
           點黑邊關掉、點照片不關，判斷在 onZoomClick（黑邊算在 <img> 框內，分不掉）-->
      <div ref="zoomRail" class="zoom-rail flex h-full w-full snap-x snap-mandatory"
        @scroll="onZoomScroll" @click="onZoomClick">
        <img v-for="im in images" :key="im.url" :src="im.url" :alt="it.title" draggable="false"
          class="h-full w-full shrink-0 snap-center object-contain" @error="imageBroken(im.url)" />
      </div>

      <!-- 箭頭只給滑鼠，手機用滑的（CSS 的 pointer: coarse 擋掉）。
           .stop 目前不是非要不可（按鈕是 dialog 的直接子層，被 @click.self 擋住了），
           留著是因為哪天有人把按鈕移進捲動容器，就會變成按箭頭順便關掉燈箱 -->
      <template v-if="images.length > 1">
        <button v-for="[d, label, icon] in [[-1, '上一張', PhCaretLeft], [1, '下一張', PhCaretRight]]" :key="d"
          class="zoom-arrow absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition active:scale-90 disabled:opacity-25"
          :class="d < 0 ? 'left-3' : 'right-3'" :aria-label="label"
          :disabled="d < 0 ? zoomAt === 0 : zoomAt === images.length - 1"
          @click.stop="zoomStep(d)">
          <component :is="icon" :size="24" weight="bold" />
        </button>
      </template>
      <button autofocus aria-label="關閉" @click="closeZoom"
        class="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition active:scale-90">
        <PhX :size="22" weight="bold" />
      </button>
      <p v-if="images.length > 1" aria-hidden="true"
        class="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-2.5 py-1 text-[13px] tabular-nums text-white backdrop-blur-sm">
        {{ zoomAt + 1 }} / {{ images.length }}
      </p>
    </dialog>
  </template>
</template>
