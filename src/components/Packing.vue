<script setup>
import { computed, ref, provide } from 'vue'
import { PhPlus, PhCopy, PhLock, PhSuitcaseRolling, PhTrash } from '@phosphor-icons/vue'
import { store, packNodes, packChildren, packProgress, packSources, packInit, ensurePacking, replacePacking,
  addPack, updatePack, deletePack, toast, MAX_DEPTH, DEFAULT_PACKING, fromTemplate, cloneNodes } from '../store'
import { subtree } from '../packing-rules'
import PackNode from './PackNode.vue'
import Sheet from './Sheet.vue'

// 行李清單（v2.15.0）：每個人自己的，同行的人看不到。第一次打開放預設清單，
// 也可以整份換成別趟的清單或恢復預設（會先確認，因為會蓋掉目前的打勾與自己加的東西）
const props = defineProps({ tripId: String })
ensurePacking(props.tripId)
const top = computed(() => packChildren(props.tripId, null))
const total = computed(() => packProgress(props.tripId))
const loading = computed(() => packInit.has(props.tripId) && !top.value.length)

function addGroup() {
  const t = prompt('群組名稱（例：托運行李）')
  if (t?.trim()) addPack(props.tripId, null, 'group', t)
}

// ---- 套用其他清單
const sourceOpen = ref(false)
const sources = computed(() => packSources(props.tripId))
const newId = () => crypto.randomUUID()
function use(label, nodes) {
  // 項數跟清單裡顯示的一樣只算物品；只剩空群組也要問，那也是使用者自己建的
  if (packNodes(props.tripId).length && !confirm(`要用「${label}」取代目前的行李清單嗎？\n\n目前的 ${total.value.total} 項物品，連同打勾和自己加的群組，會全部被換掉，換了就回不來。`)) return
  replacePacking(props.tripId, nodes)
  sourceOpen.value = false
  toast(`已換成「${label}」`)
}
const useDefault = () => use('預設清單', fromTemplate(DEFAULT_PACKING, newId))
const useTrip = t => use(t.name, cloneNodes(packNodes(t.id), newId))

// ---- 單一節點的選單（改名、數量、加子群組、刪除）。PackNode 是遞迴的，用 inject 叫到這裡，不用一層層 emit
const menu = ref(null)  // { node, depth }
const form = ref({ title: '', qty: '' })
provide('packMenu', (node, depth) => {
  menu.value = { node, depth }
  form.value = { title: node.title, qty: node.qty ?? '' }
})
const isGroup = computed(() => menu.value?.node.kind === 'group')
const qtyOk = computed(() => form.value.qty === '' || (Number.isInteger(+form.value.qty) && +form.value.qty >= 1 && +form.value.qty <= 99))
function saveMenu() {
  const n = menu.value.node
  const patch = {}
  if (form.value.title.trim() && form.value.title.trim() !== n.title) patch.title = form.value.title.trim()
  const qty = form.value.qty === '' ? null : +form.value.qty
  if (!isGroup.value && qty !== n.qty) patch.qty = qty
  if (Object.keys(patch).length) updatePack(n, patch)
  menu.value = null
}
function addSubgroup() {
  const n = menu.value.node
  const t = prompt(`在「${n.title}」裡新增群組（例：盥洗包）`)
  if (t?.trim()) addPack(props.tripId, n.id, 'group', t)
  menu.value = null
}
function removeNode() {
  const n = menu.value.node
  const inside = subtree(store.packing, n.id).size - 1
  if (!confirm(inside ? `刪除「${n.title}」和裡面的 ${inside} 項？` : `刪除「${n.title}」？`)) return
  deletePack(n)
  menu.value = null
}
</script>

<template>
  <main class="gutter pb-32 pt-4">
    <div class="mb-4">
      <p class="flex items-center gap-1 text-[12px] text-muted"><PhLock :size="12" />只有你自己看得到</p>
      <div class="mt-1 flex items-center gap-3">
        <p class="min-w-0 flex-1 text-[15px] font-semibold">
          已打包 <span class="tabular-nums">{{ total.done }} / {{ total.total }}</span>
        </p>
        <button class="btn-ghost h-9 shrink-0 px-3 text-[14px]" @click="sourceOpen = true"><PhCopy :size="16" />套用其他清單</button>
      </div>
      <div class="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
        <div class="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" :style="{ width: total.total ? (total.done / total.total) * 100 + '%' : '0' }"
          role="progressbar" :aria-valuenow="total.done" :aria-valuemax="total.total" aria-label="打包進度" />
      </div>
    </div>

    <p v-if="loading" class="py-16 text-center text-[14px] text-muted">準備預設清單中…</p>
    <div v-else-if="!top.length" class="py-12 text-center">
      <PhSuitcaseRolling :size="40" class="mx-auto text-muted" />
      <p class="mt-2 text-[15px] font-semibold">行李清單是空的</p>
      <p class="mt-1 text-[13px] text-muted">從預設清單或之前的旅程開始，或自己新增群組</p>
      <button class="btn-primary mt-4" @click="sourceOpen = true">套用清單</button>
    </div>

    <PackNode v-for="n in top" :key="n.id" :node="n" :depth="1" />

    <button class="btn-ghost h-10 w-full text-[14px]" @click="addGroup"><PhPlus :size="16" weight="bold" />新增群組</button>
  </main>

  <Sheet v-model:open="sourceOpen" title="套用其他清單">
    <p class="mb-2 px-3 text-[13px] text-muted">會整份取代目前的清單，打勾全部清掉。</p>
    <button class="row" @click="useDefault"><PhSuitcaseRolling :size="20" class="text-muted" /><span class="flex-1">預設清單</span></button>
    <button v-for="t in sources" :key="t.id" class="row" @click="useTrip(t)">
      <PhCopy :size="20" class="text-muted" />
      <span class="min-w-0 flex-1 truncate">{{ t.name }}</span>
      <span class="shrink-0 text-[13px] tabular-nums text-muted">{{ packProgress(t.id).total }} 項</span>
    </button>
    <p v-if="!sources.length" class="px-3 py-2 text-[13px] text-muted">其他旅程還沒有行李清單</p>
  </Sheet>

  <Sheet :open="!!menu" :title="isGroup ? '群組' : '物品'" @update:open="v => !v && (menu = null)">
    <div v-if="menu" class="grid gap-4 px-3 pb-2">
      <div>
        <label class="label" for="pack-title">名稱</label>
        <input id="pack-title" v-model="form.title" class="input" maxlength="100" />
      </div>
      <div v-if="!isGroup">
        <label class="label" for="pack-qty">數量（選填）</label>
        <input id="pack-qty" v-model="form.qty" class="input" type="number" inputmode="numeric" min="1" max="99" placeholder="例：5" />
        <p v-if="!qtyOk" class="mt-1 text-[12px] text-danger">數量要是 1 到 99 的整數</p>
      </div>
      <button v-if="isGroup && menu.depth < MAX_DEPTH" class="btn-ghost h-10 text-[14px]" @click="addSubgroup">
        <PhPlus :size="16" weight="bold" />在裡面新增群組
      </button>
      <button class="btn-danger h-10 text-[14px]" @click="removeNode"><PhTrash :size="16" />刪除</button>
    </div>
    <template #footer>
      <button class="btn-primary h-12 w-full" :disabled="!form.title.trim() || !qtyOk" @click="saveMenu">儲存</button>
    </template>
  </Sheet>
</template>
