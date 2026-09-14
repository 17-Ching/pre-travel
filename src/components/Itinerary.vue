<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { PhPlus, PhNote, PhCaretUp, PhCaretDown, PhCalendarBlank, PhTrash, PhPencilSimple, PhWarning } from '@phosphor-icons/vue'
import { store, tripDays, entriesOf, daySummary, dayNote, setDayNote, addEntry, addEntries, updateEntry,
  toggleEntryDone, reorderEntries, moveEntry, deleteEntry, entryTitle, scheduledSlots, toast, regionsOf, user } from '../store'
import EntryCard from './EntryCard.vue'
import Sheet from './Sheet.vue'

const props = defineProps({ tripId: String })

// F-37：行程區三時段固定顯示；餐食區五餐別，空的收合
const SLOTS = [['morning', '早上'], ['afternoon', '下午'], ['evening', '晚上']]
const MEALS = [['breakfast', '早餐'], ['lunch', '午餐'], ['snack', '點心'], ['dinner', '晚餐'], ['late_night', '宵夜']]

const days = computed(() => tripDays(props.tripId))
const date = ref('')
// 進頁預設落在今天；今天不在旅程期間內就落在 Day 1（F-37）
watch(days, list => {
  if (!list.length || (date.value && list.some(d => d.date === date.value))) return
  date.value = (list.find(d => d.isToday) ?? list[0]).date
}, { immediate: true })

const current = computed(() => days.value.find(d => d.date === date.value))
const summary = computed(() => daySummary(props.tripId, date.value))
const schedule = computed(() => SLOTS.map(([slot, label]) => ({ slot, label, entries: entriesOf(props.tripId, date.value, 'schedule', slot) })))
const meals = computed(() => MEALS.map(([slot, label]) => ({ slot, label, entries: entriesOf(props.tripId, date.value, 'meal', slot) })))
const openMeals = ref(new Set())
const shownMeals = computed(() => meals.value.filter(m => m.entries.length || openMeals.value.has(m.slot)))
const hiddenMeals = computed(() => meals.value.filter(m => !m.entries.length && !openMeals.value.has(m.slot)))

// 日期列：進頁自動捲到選中那天
const rail = ref()
const scrollToDay = () => nextTick(() => rail.value?.querySelector('[data-on="1"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }))
onMounted(scrollToDay)
watch(date, scrollToDay)

// ── 每日備註（F-43）
const noteOpen = ref(false)
const noteDraft = ref('')
function openNote() { noteDraft.value = dayNote(props.tripId, date.value); noteOpen.value = true }
function saveNote() { setDayNote(props.tripId, date.value, noteDraft.value); noteOpen.value = false }

// ── 新增 / 編輯行程項目（F-38、F-39）
const blank = () => ({ title: '', kind: 'place', transportMode: '', startTime: '', endTime: '', note: '' })
const form = ref(blank())
const formFor = ref(null)   // { slot, section } 新增；或 { entry } 編輯
const MODES = ['步行', '電車', '巴士', '計程車', '開車', '飛機', '船']

function openAdd(section, slot) {
  if (store.offline) return toast('需要網路')
  form.value = blank()
  formFor.value = { section, slot }
}
function openEdit(entry) {
  form.value = { title: entry.itemId ? '' : entry.title, kind: entry.kind, transportMode: entry.transportMode || '',
    startTime: entry.startTime || '', endTime: entry.endTime || '', note: entry.note || '' }
  formFor.value = { entry }
}
const editingRef = computed(() => Boolean(formFor.value?.entry?.itemId)) // 引用的項目標題不可改（F-38）
const canSaveForm = computed(() => {
  const f = form.value
  if (f.endTime && f.startTime && f.endTime < f.startTime) return false
  return editingRef.value || f.title.trim().length > 0
})
function submitForm() {
  const f = form.value, ctx = formFor.value
  const patch = {
    kind: f.kind, transportMode: f.kind === 'transport' ? f.transportMode.trim() : '',
    startTime: f.startTime || null, endTime: f.endTime || null, note: f.note.trim(),
  }
  if (ctx.entry) updateEntry(ctx.entry, editingRef.value ? patch : { ...patch, title: f.title.trim() })
  else addEntry({ tripId: props.tripId, date: date.value, section: ctx.section, slot: ctx.slot, itemId: null, title: f.title.trim(), ...patch })
  formFor.value = null
}

// ── 卡片選單：編輯 / 上下移 / 搬到其他天 / 刪除
const entryMenu = ref(null)
const moveFor = ref(null)
function siblings(e) { return entriesOf(props.tripId, e.date, e.section, e.slot) }
function nudge(e, dir) {
  const list = siblings(e).map(x => x.id)
  const i = list.indexOf(e.id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  reorderEntries(props.tripId, e.date, e.section, e.slot, list)
}
// F-40：有時間的項目依時間自動排序，手動調順序對它沒有意義
const canNudge = e => !e.startTime && siblings(e).length > 1
function doMove(target) {
  moveEntry(moveFor.value, target)
  toast('已搬移')
  moveFor.value = null
  entryMenu.value = null
}
function removeEntry() {
  const e = entryMenu.value
  if (!confirm(`從行程移除「${entryTitle(e)}」？`)) return
  deleteEntry(e.id)
  entryMenu.value = null
}

// ── F-41 從清單選地點加入
const pickFor = ref(null)      // { section, slot }
const picked = ref(new Set())
const pickQuery = ref('')
const pickRegion = ref('all')
const regions = computed(() => regionsOf(props.tripId))
// 所有成員清單分頁裡的「地點」，購物不出現
const pickable = computed(() => store.items
  .filter(i => i.tripId === props.tripId && i.type === 'place')
  .filter(i => pickRegion.value === 'all' || (pickRegion.value === 'none' ? !i.regionId : i.regionId === pickRegion.value))
  .filter(i => !pickQuery.value || i.title.toLowerCase().includes(pickQuery.value.toLowerCase())))
function openPick(section, slot) {
  if (store.offline) return toast('需要網路')
  picked.value = new Set(); pickQuery.value = ''; pickRegion.value = 'all'
  pickFor.value = { section, slot }
}
function togglePick(id) {
  const s = new Set(picked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  picked.value = s
}
// 已排在別天的提示（F-41）
function elsewhere(itemId) {
  const hit = scheduledSlots(itemId).filter(s => s.date !== date.value)
  if (!hit.length) return ''
  const label = [...SLOTS, ...MEALS].find(([k]) => k === hit[0].slot)?.[1] ?? ''
  return `已排在 ${hit[0].date.slice(5).replace('-', '/')} ${label}`
}
function confirmPick() {
  const ctx = pickFor.value
  const list = [...picked.value].map(id => ({
    tripId: props.tripId, date: date.value, section: ctx.section, slot: ctx.slot,
    kind: 'place', itemId: id, title: '', transportMode: '', startTime: null, endTime: null, note: '',
  }))
  if (list.length) addEntries(list)   // 一次送出，不迴圈（F-41 可多選）
  pickFor.value = null
}

// 時段的「＋」：兩個入口（F-38）
const addFor = ref(null)
</script>

<template>
  <div v-if="!days.length" class="gutter pt-10 text-center">
    <p class="text-[17px] font-semibold">還沒有日期</p>
    <p class="mt-1.5 text-[14px] text-muted">請先在專案設定填上出發日與回程日。</p>
  </div>

  <template v-else>
    <!-- 日期列（F-37）。範圍外的日子排最後並標警示色（F-46） -->
    <nav ref="rail" class="rail flex gap-2 border-b border-line py-2.5">
      <button v-for="d in days" :key="d.date" :data-on="d.date === date ? '1' : null" @click="date = d.date"
        :class="['flex shrink-0 flex-col items-start rounded-[12px] border px-3 py-1.5 transition duration-150',
          d.date === date ? 'border-transparent bg-ink text-surface'
          : d.outOfRange ? 'border-danger/40 bg-card text-danger' : 'border-line bg-card text-ink']">
        <span class="text-[13px] font-semibold tabular-nums whitespace-nowrap">
          {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
        </span>
        <span :class="['text-[11px]', d.date === date ? 'opacity-75' : 'text-muted']">
          {{ d.outOfRange ? '範圍外' : `Day ${d.dayNo}` }}
        </span>
      </button>
    </nav>

    <main class="gutter pb-32 pt-3">
      <!-- F-46：這天不在旅程日期內 -->
      <div v-if="current?.outOfRange" class="mb-3 flex items-start gap-2 rounded-[12px] border border-danger/40 bg-danger/8 p-2.5 text-[13px] text-danger">
        <PhWarning :size="16" class="mt-0.5 shrink-0" />
        <span>這天已不在旅程日期內，請搬到其他天或刪除。資料不會自動消失。</span>
      </div>

      <p class="text-[13px] tabular-nums text-muted">
        行程 {{ summary.schedule }} 項・餐食備選 {{ summary.meal }} 間・已完成 {{ summary.done }}
      </p>

      <!-- 每日備註（F-43）：空的時候只有一行淡字 -->
      <button class="mt-2 flex w-full items-start gap-2 rounded-[12px] border border-line bg-card p-2.5 text-left" @click="openNote">
        <PhNote :size="16" class="mt-0.5 shrink-0 text-muted" />
        <span v-if="dayNote(tripId, date)" class="min-w-0 flex-1 whitespace-pre-line text-[13px] leading-relaxed">{{ dayNote(tripId, date) }}</span>
        <span v-else class="flex-1 text-[13px] text-muted">＋ 這天的備註</span>
      </button>

      <!-- 上半：行程區 -->
      <section class="mt-5">
        <h3 class="mb-2 text-[13px] font-semibold tracking-wide text-muted">行程</h3>
        <div class="grid gap-4">
          <div v-for="s in schedule" :key="s.slot">
            <div class="mb-1.5 flex items-center gap-2">
              <span class="size-1.5 rounded-full bg-tint" aria-hidden="true" />
              <h4 class="text-[14px] font-semibold">{{ s.label }}</h4>
              <span v-if="s.entries.length" class="text-[12px] tabular-nums text-muted">{{ s.entries.length }}</span>
              <button v-if="s.entries.length" class="ml-auto icon-btn size-7 text-muted" aria-label="加入行程" @click="addFor = { section: 'schedule', slot: s.slot }">
                <PhPlus :size="15" weight="bold" />
              </button>
            </div>
            <div v-if="s.entries.length" class="grid gap-2">
              <EntryCard v-for="e in s.entries" :key="e.id" :entry="e"
                @toggle="toggleEntryDone(e)" @menu="entryMenu = e" />
            </div>
            <button v-else class="w-full rounded-[12px] border border-dashed border-line py-3 text-[13px] text-muted"
              @click="addFor = { section: 'schedule', slot: s.slot }">＋ 加入行程</button>
          </div>
        </div>
      </section>

      <!-- 下半：餐食備選區 -->
      <section class="mt-6">
        <h3 class="mb-2 text-[13px] font-semibold tracking-wide text-muted">餐食備選</h3>
        <div v-if="shownMeals.length" class="grid gap-4">
          <div v-for="m in shownMeals" :key="m.slot">
            <div class="mb-1.5 flex items-center gap-2">
              <span class="size-1.5 rounded-full bg-accent" aria-hidden="true" />
              <h4 class="text-[14px] font-semibold">{{ m.label }}</h4>
              <span v-if="m.entries.length" class="text-[12px] tabular-nums text-muted">{{ m.entries.length }}</span>
              <button class="ml-auto icon-btn size-7 text-muted" :aria-label="`加入${m.label}候選`" @click="addFor = { section: 'meal', slot: m.slot }">
                <PhPlus :size="15" weight="bold" />
              </button>
            </div>
            <div v-if="m.entries.length" class="grid gap-2">
              <EntryCard v-for="e in m.entries" :key="e.id" :entry="e"
                @toggle="toggleEntryDone(e)" @menu="entryMenu = e" />
            </div>
            <p v-else class="rounded-[12px] border border-dashed border-line py-2.5 text-center text-[12px] text-muted">還沒有候選</p>
          </div>
        </div>
        <!-- 空的餐別收合成一排小按鈕 -->
        <div v-if="hiddenMeals.length" class="mt-2 flex flex-wrap gap-2">
          <button v-for="m in hiddenMeals" :key="m.slot" class="chip-state" @click="openMeals = new Set([...openMeals, m.slot])">
            ＋ {{ m.label }}
          </button>
        </div>
      </section>
    </main>

    <!-- 時段的「＋」：兩個入口（F-38） -->
    <Sheet :open="!!addFor" title="加入" @update:open="v => !v && (addFor = null)">
      <button class="row" @click="openPick(addFor.section, addFor.slot); addFor = null">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">從清單選地點</span>
      </button>
      <button class="row" @click="openAdd(addFor.section, addFor.slot); addFor = null">
        <PhPencilSimple :size="20" class="text-muted" /><span class="flex-1">自己打一筆</span>
      </button>
    </Sheet>

    <!-- 新增 / 編輯表單（F-38、F-39、F-40） -->
    <Sheet :open="!!formFor" :title="formFor?.entry ? '編輯' : '新增'" @update:open="v => !v && (formFor = null)">
      <div class="grid gap-3 px-2 pb-2">
        <div v-if="!editingRef">
          <label class="label" for="e-title">標題</label>
          <input id="e-title" v-model="form.title" class="input" maxlength="100"
            :placeholder="form.kind === 'transport' ? '例：新宿 → 鎌倉' : '要做什麼'" />
        </div>
        <p v-else class="rounded-[10px] bg-tint-soft/50 px-3 py-2 text-[13px] text-muted">
          這筆引用清單裡的「{{ entryTitle(formFor.entry) }}」，標題要改請到該地點編輯。
        </p>

        <!-- 餐食區沒有交通類型（資料庫也擋） -->
        <div v-if="formFor?.section !== 'meal' && formFor?.entry?.section !== 'meal' && !editingRef">
          <span class="label">類型</span>
          <div class="relative grid grid-cols-2 rounded-[12px] bg-surface-2 p-1">
            <div class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-[9px] bg-card shadow-e1 transition-transform duration-200 ease-out"
              :style="{ transform: form.kind === 'transport' ? 'translateX(100%)' : 'none' }" aria-hidden="true" />
            <button v-for="[k, l] in [['place', '一般'], ['transport', '交通']]" :key="k"
              :class="['relative z-10 h-8 rounded-[9px] text-[14px] font-semibold transition-colors duration-150', form.kind === k ? 'text-ink' : 'text-muted']"
              @click="form.kind = k">{{ l }}</button>
          </div>
        </div>

        <div v-if="form.kind === 'transport'">
          <label class="label" for="e-mode">交通方式</label>
          <input id="e-mode" v-model="form.transportMode" class="input" maxlength="30" placeholder="例：JR 橫須賀線" />
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="m in MODES" :key="m" class="chip-state" @click="form.transportMode = m">{{ m }}</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="e-start">開始時間（選填）</label><input id="e-start" v-model="form.startTime" type="time" class="input" /></div>
          <div><label class="label" for="e-end">結束時間（選填）</label><input id="e-end" v-model="form.endTime" type="time" class="input" /></div>
        </div>
        <p v-if="form.startTime && form.endTime && form.endTime < form.startTime" class="-mt-1 text-[12px] text-danger">
          結束時間不能早於開始時間
        </p>

        <div>
          <label class="label" for="e-note">當天備註（選填）</label>
          <textarea id="e-note" v-model="form.note" class="input h-20 resize-y py-2.5" maxlength="500" placeholder="只屬於這一天，不會寫回清單的地點" />
        </div>
      </div>
      <template #footer>
        <button class="btn-primary h-12 w-full" :disabled="!canSaveForm" @click="submitForm">儲存</button>
      </template>
    </Sheet>

    <!-- 卡片選單 -->
    <Sheet :open="!!entryMenu" :title="entryMenu ? entryTitle(entryMenu) : ''" @update:open="v => !v && (entryMenu = null)">
      <button class="row" :disabled="store.offline" @click="openEdit(entryMenu); entryMenu = null">
        <PhPencilSimple :size="20" class="text-muted" /><span class="flex-1">編輯時間與備註</span>
      </button>
      <template v-if="entryMenu && canNudge(entryMenu)">
        <button class="row" :disabled="store.offline" @click="nudge(entryMenu, -1)">
          <PhCaretUp :size="20" class="text-muted" /><span class="flex-1">往上移</span>
        </button>
        <button class="row" :disabled="store.offline" @click="nudge(entryMenu, 1)">
          <PhCaretDown :size="20" class="text-muted" /><span class="flex-1">往下移</span>
        </button>
      </template>
      <p v-else-if="entryMenu?.startTime" class="px-3 py-1.5 text-[12px] text-muted">有時間的項目會依時間自動排序</p>
      <button class="row" :disabled="store.offline" @click="moveFor = entryMenu">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">搬到其他天或時段</span>
      </button>
      <button class="row mt-1 border-t border-line pt-1 text-danger" :disabled="store.offline" @click="removeEntry">
        <PhTrash :size="20" /><span class="flex-1">從行程移除</span>
      </button>
      <p v-if="store.offline" class="px-3 pb-1 pt-2 text-[13px] text-muted">離線中，只能勾選完成</p>
    </Sheet>

    <!-- 搬到其他天／時段（取代跨日拖曳） -->
    <Sheet :open="!!moveFor" title="搬到" @update:open="v => !v && (moveFor = null)">
      <div class="px-2 pb-2">
        <p class="mb-2 mt-1 text-[13px] font-semibold">日期</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="d in days" :key="d.date"
            :class="['chip-region', moveFor?.date === d.date && 'on']"
            @click="moveFor = { ...moveFor, date: d.date }">
            {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
          </button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">時段</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in SLOTS" :key="slot" class="chip-state"
            @click="doMove({ date: moveFor.date, section: 'schedule', slot })">{{ label }}</button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">餐別</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in MEALS" :key="slot" class="chip-state"
            :disabled="moveFor?.kind === 'transport'"
            @click="doMove({ date: moveFor.date, section: 'meal', slot })">{{ label }}</button>
        </div>
        <p v-if="moveFor?.kind === 'transport'" class="mt-2 text-[12px] text-muted">交通項目不能放進餐食備選。</p>
      </div>
    </Sheet>

    <!-- F-41 從清單選地點，可多選 -->
    <Sheet :open="!!pickFor" title="從清單選地點" @update:open="v => !v && (pickFor = null)">
      <div class="px-2 pb-2">
        <input v-model="pickQuery" class="input" placeholder="搜尋地點" />
        <div class="mt-2 flex flex-wrap gap-2">
          <button :class="['chip-region', pickRegion === 'all' && 'on']" @click="pickRegion = 'all'">全部</button>
          <button v-for="r in regions" :key="r.id" :class="['chip-region', pickRegion === r.id && 'on']" @click="pickRegion = r.id">{{ r.name }}</button>
          <button :class="['chip-region', pickRegion === 'none' && 'on']" @click="pickRegion = 'none'">未分類</button>
        </div>
        <p v-if="!pickable.length" class="py-6 text-center text-[13px] text-muted">沒有符合的地點</p>
        <ul v-else class="mt-3 grid gap-1.5">
          <li v-for="i in pickable" :key="i.id">
            <button class="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-card p-2 text-left" @click="togglePick(i.id)">
              <span :class="['flex size-5 shrink-0 items-center justify-center rounded-md border',
                picked.has(i.id) ? 'border-transparent bg-accent text-accent-fg' : 'border-line']">
                <PhPlus v-if="!picked.has(i.id)" :size="12" weight="bold" class="opacity-40" />
                <span v-else class="text-[12px] font-bold">✓</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[14px] font-medium">{{ i.title }}</span>
                <span class="block truncate text-[11px] text-muted">
                  {{ user(i.ownerUserId)?.name }}<template v-if="elsewhere(i.id)">・{{ elsewhere(i.id) }}</template>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
      <template #footer>
        <button class="btn-primary h-12 w-full" :disabled="!picked.size" @click="confirmPick">
          加入 {{ picked.size || '' }} 個地點
        </button>
      </template>
    </Sheet>

    <!-- 每日備註編輯 -->
    <Sheet v-model:open="noteOpen" title="這天的備註">
      <div class="px-2 pb-2">
        <textarea v-model="noteDraft" class="input h-32 resize-y py-2.5" maxlength="500" placeholder="住哪間飯店、天氣、下雨備案…" />
      </div>
      <template #footer>
        <button class="btn-primary h-12 w-full" @click="saveNote">儲存</button>
      </template>
    </Sheet>
  </template>
</template>
