<script>
import { reactive } from 'vue'
// 收起了哪些群組。預設全開（跟願望清單一樣），只留在記憶體：切頁籤再回來還收著，重開 app 全開
const closed = reactive(new Set())
</script>

<script setup>
import { computed, ref, inject } from 'vue'
import { PhCaretRight, PhCheck, PhDotsThreeVertical, PhPencilSimple, PhTrash } from '@phosphor-icons/vue'
import { packChildren, packProgress, addPack, updatePack, deletePack, restorePack, toast } from '../store'

// 行李清單的一個節點：群組（可收合，底下再遞迴）或物品（勾選）。depth＝第幾層群組
const props = defineProps({ node: Object, depth: { type: Number, default: 1 } })
const openMenu = inject('packMenu')
const n = computed(() => props.node)
const kids = computed(() => packChildren(n.value.tripId, n.value.id))
const prog = computed(() => packProgress(n.value.tripId, n.value.id))
const open = computed(() => !closed.has(n.value.id))
const toggleOpen = () => (open.value ? closed.add(n.value.id) : closed.delete(n.value.id))

// 群組底下直接打字加物品；按完留在輸入框，一路連打下去
const draft = ref('')
function add() {
  addPack(n.value.tripId, n.value.id, 'item', draft.value)
  draft.value = ''
}
// 物品一鍵刪除，不跳確認（一個一個問太煩），改給「復原」
function remove() {
  const item = { ...n.value }
  deletePack(n.value)
  toast(`已刪除「${item.title}」`, { label: '復原', run: () => restorePack(item) })
}

// 三層各一種樣子，一眼分得出在哪一層：
// 1 層＝卡片＋有底色的標題列；2 層＝卡片裡的灰底小框；3 層＝小框裡左邊一條色線
const box = { 1: 'card mb-3 overflow-hidden', 2: 'mt-2 rounded-[12px] bg-surface-2 px-2.5', 3: 'mt-1.5 border-l-2 border-tint/50 pl-2.5' }
const head = { 1: 'bg-tint-soft px-3 min-h-12', 2: 'min-h-10', 3: 'min-h-9' }
const titleCls = { 1: 'text-[16px] font-bold', 2: 'text-[15px] font-semibold', 3: 'text-[14px] font-semibold text-tint' }
</script>

<template>
  <!-- 物品：右邊編輯（名稱、數量）與刪除 -->
  <div v-if="n.kind === 'item'" class="flex min-h-10 items-center gap-2.5">
    <button :aria-label="n.packed ? `取消打包 ${n.title}` : `打包 ${n.title}`" @click="updatePack(n, { packed: !n.packed })"
      class="-m-2 shrink-0 p-2">
      <span :class="['flex size-5 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150',
        n.packed ? 'border-transparent bg-accent text-accent-fg' : 'border-muted/60 text-transparent']">
        <PhCheck :size="11" weight="bold" />
      </span>
    </button>
    <!-- 名稱也能點來打勾：圓圈太小，手指常常按不準 -->
    <button class="min-w-0 flex-1 py-2 text-left text-[15px]" @click="updatePack(n, { packed: !n.packed })">
      <span :class="['wrap-anywhere', n.packed && 'text-muted line-through decoration-1']">{{ n.title }}</span>
      <span v-if="n.qty" class="ml-1.5 text-[13px] tabular-nums text-muted">×{{ n.qty }}</span>
    </button>
    <button class="icon-btn size-8 shrink-0 text-muted" :aria-label="`編輯 ${n.title}`" @click="openMenu(n, depth)"><PhPencilSimple :size="16" /></button>
    <button class="icon-btn -mr-2 size-8 shrink-0 text-muted" :aria-label="`刪除 ${n.title}`" @click="remove"><PhTrash :size="16" /></button>
  </div>

  <section v-else :class="box[depth]">
    <div :class="['flex items-center gap-1', head[depth]]">
      <button class="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left" :aria-expanded="open" @click="toggleOpen">
        <PhCaretRight :size="13" weight="bold" :class="['shrink-0 text-muted transition-transform duration-200', open && 'rotate-90']" />
        <span :class="['min-w-0 truncate', titleCls[depth]]">{{ n.title }}</span>
        <span v-if="prog.total" :class="['shrink-0 text-[12px] font-normal tabular-nums', prog.done === prog.total ? 'text-accent' : 'text-muted']">{{ prog.done }}/{{ prog.total }}</span>
      </button>
      <button class="icon-btn -mr-2 size-8 shrink-0 text-muted" :aria-label="`${n.title} 的動作`" @click="openMenu(n, depth)"><PhDotsThreeVertical :size="16" weight="bold" /></button>
    </div>
    <div v-if="open" :class="depth === 1 ? 'px-3 pb-3' : 'pb-2'">
      <PackNode v-for="k in kids" :key="k.id" :node="k" :depth="k.kind === 'group' ? depth + 1 : depth" />
      <!-- 手機上 Enter 不順手（有些輸入法 Enter 是選字），旁邊一顆「新增」 -->
      <div class="mt-2 flex gap-2">
        <input v-model="draft" class="input h-10 min-w-0 flex-1" maxlength="100" :placeholder="`在「${n.title}」加物品`" @keydown.enter.prevent="e => !e.isComposing && add()" />
        <button class="btn-ghost h-10 shrink-0 px-3 text-[14px]" :disabled="!draft.trim()" @click="add">新增</button>
      </div>
    </div>
  </section>
</template>
