<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { PhPlus, PhNote, PhCaretUp, PhCaretDown, PhCalendarBlank, PhTrash, PhPencilSimple, PhWarning,
  PhArrowRight, PhArrowSquareOut, PhX, PhAirplaneTakeoff, PhBed } from '@phosphor-icons/vue'
import { store, tripDays, entriesOf, flightsOf, staysOf, stayNights, stayDayLabel, addDays, daySummary,
  dayNote, setDayNote, addEntry, addEntries, updateEntry,
  toggleEntryDone, reorderEntries, moveEntry, deleteEntry, entryTitle, entryFromItem, scheduledSlots, toast,
  regionsOf, user, me, tripMembers, item as findItem, newLink, linkLabel, sourceLabel, MAX_LINKS } from '../store'
import { useLinkPreview } from '../link-preview'
import EntryCard from './EntryCard.vue'
import Avatar from './Avatar.vue'
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

// ── 航班：出發日與回程日各一區，一天可以有好幾班（同行的人搭不同班）。
// 已經有航班的日子也要顯示，否則縮短旅程日期（F-46）之後那些航班就看不見了。
const flights = computed(() => flightsOf(props.tripId, date.value))
const showFlights = computed(() => {
  const inRange = days.value.filter(d => !d.outOfRange)
  return flights.value.length > 0 || date.value === inRange[0]?.date || date.value === inRange.at(-1)?.date
})
const flightLabel = computed(() => {
  const inRange = days.value.filter(d => !d.outOfRange)
  if (date.value === inRange[0]?.date) return '出發航班'
  if (date.value === inRange.at(-1)?.date) return '回程航班'
  return '航班'
})
// ── 住宿：一筆跨多天，涵蓋這天就顯示。換飯店就是再加一筆（F-49）
const stays = computed(() => staysOf(props.tripId, date.value))

// 誰搭這班：專案成員（離開的成員不列，但已經選到的還是看得到，避免資料無聲消失）
const members = computed(() => [{ userId: store.me }, ...tripMembers(props.tripId)
  .filter(m => m.userId !== store.me && m.status === 'active')]
  .map(m => ({ userId: m.userId, user: m.userId === store.me ? me() : user(m.userId) })))

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
// 航班的標題是「出發地 → 抵達地」，拆成兩格填：箭頭在電腦上很難打（使用者回報）
const ARROW = ' → '
const blank = kind => ({ title: '', kind, transportMode: '', startTime: '', endTime: '', note: '', links: [],
  passengerIds: [], startDate: '', endDate: '', from: '', to: '' })
const form = ref(blank('place'))
const formFor = ref(null)   // { slot, section } 新增；或 { entry } 編輯
const MODES = ['步行', '電車', '巴士', '計程車', '開車', '飛機', '船']

// kind 在開啟時就決定（抽屜裡「自己打一筆」與「加一段交通」是兩個入口），
// 表單裡不再放類型切換：使用者反映在那裡找不到交通。
function openAdd(section, slot, kind = 'place') {
  if (store.offline) return toast('需要網路')
  form.value = blank(kind)
  // 住宿預設從看的這天住一晚，兩個日期都能改
  if (kind === 'stay') Object.assign(form.value, { startDate: date.value, endDate: addDays(date.value, 1) })
  formFor.value = { section, slot }
}
const ROUTE_KINDS = ['flight', 'transport']
function openEdit(entry) {
  // 航班與交通的標題存的是一整串「A → B」，編輯時拆回兩格。
  // 只切第一個箭頭：轉機寫成「東京 → 首爾 → 倫敦」時，後半整段留在「到」，存回去才不會掉字。
  const isRouteKind = ROUTE_KINDS.includes(entry.kind)
  const arrowAt = isRouteKind ? entry.title.indexOf('→') : -1
  const from = !isRouteKind ? '' : arrowAt < 0 ? entry.title.trim() : entry.title.slice(0, arrowAt).trim()
  const to = arrowAt < 0 ? '' : entry.title.slice(arrowAt + 1).trim()
  form.value = { title: entry.itemId ? '' : entry.title, kind: entry.kind, transportMode: entry.transportMode || '',
    startTime: entry.startTime || '', endTime: entry.endTime || '', note: entry.note || '',
    links: JSON.parse(JSON.stringify(entry.links ?? [])), passengerIds: [...(entry.passengerIds ?? [])],
    startDate: entry.date, endDate: entry.endDate || '', from, to }
  formFor.value = { entry }
}
const editingRef = computed(() => Boolean(formFor.value?.entry?.itemId)) // 引用的項目標題不可改（F-38）
const isFlight = computed(() => form.value.kind === 'flight')
const isStay = computed(() => form.value.kind === 'stay')
// 航班（紅眼）與住宿（隔天退房）的「結束」本來就在隔天，其他項目不行
const badTimes = computed(() => {
  const f = form.value
  return Boolean(!isFlight.value && !isStay.value && f.startTime && f.endTime && f.endTime < f.startTime)
})
const stayStart = computed(() => form.value.startDate || date.value)
const badStayRange = computed(() => Boolean(isStay.value && form.value.endDate && form.value.endDate < stayStart.value))
// 航班與交通都是「從哪到哪」，標題拆兩格填，箭頭由系統補 ——
// 在電腦上打「→」很麻煩（使用者回報過，航班才改成兩格的）
const isRoute = computed(() => ROUTE_KINDS.includes(form.value.kind))
// 標題由兩格組出來，只填一格也存得起來（不留孤零零的箭頭）
const composedTitle = computed(() => {
  const f = form.value
  if (!isRoute.value) return f.title.trim()
  return [f.from.trim(), f.to.trim()].filter(Boolean).join(ARROW)
})
const canSaveForm = computed(() => !badTimes.value && !badStayRange.value
  && (!isStay.value || Boolean(form.value.endDate))
  && (editingRef.value || composedTitle.value.length > 0))
// 連結在行程這一側是自己的一份，改了不會回寫清單。
// 但讀標題的方式跟清單一樣（F-14，共用 useLinkPreview）：貼上就自動填連結標題，
// 標題還空著的話連項目標題一起帶。行程沒有圖片欄位，所以不動預覽圖。
const { previews, load: loadPreview } = useLinkPreview()
function addFormLink() { if (form.value.links.length < MAX_LINKS) form.value.links.push(newLink()) }
async function onUrl(l) {
  const d = await loadPreview(l)
  if (d && !editingRef.value && !form.value.title.trim()) form.value.title = d.title
}
// paste 事件當下 input 的值還是舊的，要等瀏覽器寫進去才讀得到
const onPaste = l => setTimeout(() => onUrl(l))
function addDesc(l) {
  const d = previews.value[l.id]?.data?.description
  if (d) form.value.note = (form.value.note ? form.value.note + '\n' : '') + d
}
function togglePassenger(id) {
  const list = form.value.passengerIds
  const i = list.indexOf(id)
  i < 0 ? list.push(id) : list.splice(i, 1)
}
function submitForm() {
  const f = form.value, ctx = formFor.value
  const patch = {
    kind: f.kind, transportMode: f.kind === 'place' ? '' : f.transportMode.trim(),
    startTime: f.startTime || null, endTime: f.endTime || null, note: f.note.trim(),
    links: f.links.filter(l => l.url.trim()),
    passengerIds: f.kind === 'flight' ? [...f.passengerIds] : [],
    // 住宿是唯一自己帶日期區間的：編輯時連入住日一起改，不走「搬到其他天」
    ...(isStay.value ? { date: stayStart.value, endDate: f.endDate } : {}),
  }
  if (ctx.entry) updateEntry(ctx.entry, editingRef.value ? patch : { ...patch, title: composedTitle.value })
  else {
    const created = addEntry({ tripId: props.tripId, date: date.value, section: ctx.section, slot: ctx.slot, itemId: null, title: composedTitle.value, ...patch })
    // 從兩筆之間的加號進來的：新的那段要排在點下去的那一筆後面，不是整個時段的最後
    if (insertAfter.value) {
      const ids = entriesOf(props.tripId, date.value, ctx.section, ctx.slot).map(e => e.id).filter(id => id !== created.id)
      const at = ids.indexOf(insertAfter.value)
      ids.splice(at < 0 ? ids.length : at + 1, 0, created.id)
      reorderEntries(props.tripId, date.value, ctx.section, ctx.slot, ids)
    }
  }
  insertAfter.value = null
  formFor.value = null
}

// 兩筆之間的加號：插一段交通進去。記住點的是哪一筆後面，存檔時才知道要排在哪
const insertAfter = ref(null)
function openTransportAfter(slot, prev) {
  openAdd('schedule', slot, 'transport')
  if (!formFor.value) return   // 離線時 openAdd 會擋下來
  insertAfter.value = prev.id
  // F-40：有時間的一律排在沒時間的前面。前一筆有時間、新這段沒有的話，它會被丟到
  // 整個時段的最後，看起來像沒插進去。所以帶上前一筆的結束時間（沒有就用開始時間）：
  // 時間相同時由 order 決定先後，剛好落在它後面。表單裡看得到，不想要可以清掉。
  form.value.startTime = prev.endTime || prev.startTime || ''
}

// ── 卡片選單：編輯 / 上下移 / 搬到其他天 / 刪除
const entryMenu = ref(null)
// 搬到其他天。要搬的項目與選好的目的地分開放 ——
// 原本是把選好的日期寫回 moveFor（moveFor = { ...moveFor, date }），那個展開會做出一份
// 跟 store 脫鉤的普通物件，doMove 交給 moveEntry 的就不是畫面上那一筆，
// 結果是伺服器真的改了、本地鏡像沒動，看起來就像「搬移沒有成功」，重新整理才會跳過去。
const moveFor = ref(null)
const moveTo = ref(null)
function openMove(e) {
  moveFor.value = e
  moveTo.value = { date: e.date, section: e.section, slot: e.slot }
}
// 沒挑到新位置就不給按，不然會送出一筆原地不動的更新
const moveChanged = computed(() => {
  const e = moveFor.value, t = moveTo.value
  return Boolean(e && t) && (t.date !== e.date || t.section !== e.section || t.slot !== e.slot)
})
// ── 把住宿放進某天的時段
// 住宿是跨多天的一筆、自己成一區，不會出現在早上／下午／晚上裡。但「傍晚回飯店
// check-in」「早上退房寄行李」是真的要排進時段的事，所以提供一鍵把住宿資訊放過去。
//
// 複製一份而不是引用：行程項目只能引用「願望清單的項目」（資料庫的
// transport_has_no_item 約束：kind = 'place' or item_id is null），住宿不是清單項目，
// 沒有可以引用的對象。所以改了住宿名稱，已經放進時段的那筆不會跟著變。
const stayInto = ref(null)
const stayTo = ref(null)
function openStayInto(e) {
  stayInto.value = e
  // 預設就是現在在看的這天的晚上 —— check-in 最常排在晚上
  stayTo.value = { date: date.value, slot: 'evening' }
}
const stayIntoLabel = computed(() => {
  const t = stayTo.value
  if (!t) return ''
  const d = days.value.find(x => x.date === t.date)
  const day = d ? `${d.date.slice(5).replace('-', '/')}（${d.weekday}）` : t.date
  return `${day} ${SLOTS.find(([k]) => k === t.slot)?.[1] ?? ''}`
})
function doStayInto() {
  const s = stayInto.value
  addEntry({
    tripId: props.tripId,
    date: stayTo.value.date,
    section: 'schedule',
    slot: stayTo.value.slot,
    kind: 'place',
    title: entryTitle(s),
    // 連結（地圖、訂房頁）帶過去，當天點得到。備註留空：住宿的備註是訂房代號那類
    // 長期資訊，塞進時段只是重複一份，當天要寫什麼讓使用者自己打
    links: JSON.parse(JSON.stringify(s.links ?? [])),
  })
  toast('已加入行程')
  stayInto.value = null
  entryMenu.value = null
}

const moveLabel = computed(() => {
  const t = moveTo.value
  if (!t) return ''
  const d = days.value.find(x => x.date === t.date)
  const day = d ? `${d.date.slice(5).replace('-', '/')}（${d.weekday}）` : t.date
  // 航班自己成一區，沒有時段的概念
  if (moveFor.value?.kind === 'flight') return day
  return `${day} ${[...SLOTS, ...MEALS].find(([k]) => k === t.slot)?.[1] ?? ''}`
})
// 航班與住宿各自成區，上下移只在同一區裡換，不要動到同一個時段的其他項目
function siblings(e) {
  if (e.kind === 'flight') return flightsOf(props.tripId, e.date)
  if (e.kind === 'stay') return staysOf(props.tripId, date.value)
  return entriesOf(props.tripId, e.date, e.section, e.slot)
}
function nudge(e, dir) {
  const list = siblings(e).map(x => x.id)
  const i = list.indexOf(e.id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  reorderEntries(props.tripId, e.date, e.section, e.slot, list)
}
// F-40：有時間的項目依時間自動排序，手動調順序對它沒有意義
const canNudge = e => !e.startTime && siblings(e).length > 1
function doMove() {
  moveEntry(moveFor.value, moveTo.value)
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
  // 用 store 查，不是查 pickable：勾選後改了搜尋字串，勾過的項目就不在 pickable 裡了
  const list = [...picked.value]
    .map(id => findItem(id))
    .filter(Boolean)
    .map(it => entryFromItem(it, { tripId: props.tripId, date: date.value, section: ctx.section, slot: ctx.slot }))
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
        <template v-if="summary.flight">航班 {{ summary.flight }} 班・</template>行程 {{ summary.schedule }} 項・餐食備選 {{ summary.meal }} 間・已完成 {{ summary.done }}
      </p>

      <!-- 航班：出發日與回程日各一區。一天可以有好幾班，各自標誰搭 -->
      <section v-if="showFlights" class="mt-4">
        <div class="mb-1.5 flex items-center gap-2">
          <PhAirplaneTakeoff :size="16" class="text-tint" />
          <h3 class="text-[13px] font-semibold tracking-wide text-muted">{{ flightLabel }}</h3>
          <span v-if="flights.length" class="text-[12px] tabular-nums text-muted">{{ flights.length }}</span>
          <button v-if="flights.length" class="ml-auto icon-btn size-7 text-muted" aria-label="再加一班" @click="openAdd('schedule', 'morning', 'flight')">
            <PhPlus :size="15" weight="bold" />
          </button>
        </div>
        <div v-if="flights.length" class="grid gap-2">
          <EntryCard v-for="e in flights" :key="e.id" :entry="e" @toggle="toggleEntryDone(e)" @menu="entryMenu = e" />
        </div>
        <button v-else class="w-full rounded-[12px] border border-dashed border-line py-3 text-[13px] text-muted"
          @click="openAdd('schedule', 'morning', 'flight')">＋ 加航班</button>
      </section>

      <!-- 住宿（F-49）：一筆住宿跨多天，涵蓋這天就出現。換飯店＝再加一筆 -->
      <section class="mt-4">
        <div class="mb-1.5 flex items-center gap-2">
          <PhBed :size="16" class="text-tint" />
          <h3 class="text-[13px] font-semibold tracking-wide text-muted">住宿</h3>
          <span v-if="stays.length > 1" class="text-[12px] tabular-nums text-muted">{{ stays.length }}</span>
          <button v-if="stays.length" class="ml-auto icon-btn size-7 text-muted" aria-label="再加一間住宿" @click="openAdd('schedule', 'morning', 'stay')">
            <PhPlus :size="15" weight="bold" />
          </button>
        </div>
        <div v-if="stays.length" class="grid gap-2">
          <EntryCard v-for="e in stays" :key="e.id" :entry="e"
            :badge="`${stayDayLabel(e, date)}・共 ${stayNights(e)} 晚`"
            @toggle="toggleEntryDone(e)" @menu="entryMenu = e" />
        </div>
        <button v-else class="w-full rounded-[12px] border border-dashed border-line py-3 text-[13px] text-muted"
          @click="openAdd('schedule', 'morning', 'stay')">＋ 加住宿</button>
      </section>

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
              <template v-for="(e, i) in s.entries" :key="e.id">
                <EntryCard :entry="e" @toggle="toggleEntryDone(e)" @menu="entryMenu = e" />
                <!-- 每一筆後面都能插一段交通，包含最後一筆 —— 早上的最後一個點到下午的
                     第一個點之間也要移動，那段就加在這個時段的尾巴。
                     只有「下一筆已經是交通」時不放，那個空隙已經有東西了。 -->
                <button v-if="i === s.entries.length - 1 || s.entries[i + 1].kind !== 'transport'"
                  class="flex items-center gap-2 py-0.5" :disabled="store.offline"
                  :aria-label="`在「${entryTitle(e)}」後面加一段交通`"
                  @click="openTransportAfter(s.slot, e)">
                  <span class="ml-[23px] flex size-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-tint/60 text-tint">
                    <PhPlus :size="10" weight="bold" />
                  </span>
                  <!-- 光一個加號看不出來是要加什麼，寫出來才不用猜 -->
                  <span class="shrink-0 text-[11px] text-tint">加一段交通</span>
                  <span class="h-px flex-1 border-t border-dashed border-tint/30" aria-hidden="true" />
                </button>
              </template>
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

    <!-- 時段的「＋」：三個入口（F-38、F-39）。交通獨立一列，藏在表單的類型切換裡沒人找得到 -->
    <Sheet :open="!!addFor" title="加入" @update:open="v => !v && (addFor = null)">
      <button class="row" @click="openPick(addFor.section, addFor.slot); addFor = null">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">從願望清單選地點</span>
      </button>
      <button class="row" @click="openAdd(addFor.section, addFor.slot); addFor = null">
        <PhPencilSimple :size="20" class="text-muted" /><span class="flex-1">自己打一筆</span>
      </button>
      <!-- 餐食備選不能放交通（F-42，資料庫也擋） -->
      <button v-if="addFor?.section === 'schedule'" class="row" @click="openAdd(addFor.section, addFor.slot, 'transport'); addFor = null">
        <PhArrowRight :size="20" class="text-tint" weight="bold" /><span class="flex-1">加一段交通</span>
      </button>
    </Sheet>

    <!-- 新增 / 編輯表單（F-38、F-39、F-40） -->
    <Sheet :open="!!formFor" :title="formFor?.entry ? '編輯' : isFlight ? '加航班' : isStay ? '加住宿' : form.kind === 'transport' ? '加一段交通' : '新增'" @update:open="v => !v && (formFor = null)">
      <div class="grid gap-3 px-2 pb-2">
        <!-- 航線與交通路線都拆兩格，箭頭由系統補上：使用者反映在電腦上打「→」很麻煩 -->
        <div v-if="isRoute && !editingRef">
          <span class="label">{{ isFlight ? '航線' : '路線' }}</span>
          <div class="flex items-center gap-2">
            <input v-model="form.from" class="input min-w-0 flex-1" maxlength="45"
              :placeholder="isFlight ? '從（例：桃園）' : '從（例：新宿）'" aria-label="出發地" />
            <PhArrowRight :size="18" weight="bold" class="shrink-0 text-muted" aria-hidden="true" />
            <input v-model="form.to" class="input min-w-0 flex-1" maxlength="45"
              :placeholder="isFlight ? '到（例：成田）' : '到（例：鎌倉）'" aria-label="抵達地" />
          </div>
        </div>
        <div v-else-if="!editingRef">
          <label class="label" for="e-title">{{ isStay ? '住宿名稱' : '標題' }}</label>
          <input id="e-title" v-model="form.title" class="input" maxlength="100"
            :placeholder="isStay ? '例：東橫 INN 新宿' : '要做什麼'" />
        </div>
        <p v-else class="rounded-[10px] bg-tint-soft/50 px-3 py-2 text-[13px] text-muted">
          這筆引用清單裡的「{{ entryTitle(formFor.entry) }}」，標題與照片跟著清單走；下面的備註與連結只屬於行程這一筆。
        </p>

        <div v-if="isFlight">
          <label class="label" for="e-mode">航空公司與班次</label>
          <input id="e-mode" v-model="form.transportMode" class="input" maxlength="30" placeholder="例：BR189" />
        </div>
        <div v-else-if="form.kind === 'transport'">
          <label class="label" for="e-mode">交通方式</label>
          <input id="e-mode" v-model="form.transportMode" class="input" maxlength="30" placeholder="例：JR 橫須賀線" />
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="m in MODES" :key="m" class="chip-state" @click="form.transportMode = m">{{ m }}</button>
          </div>
        </div>

        <!-- 同行的人可能搭不同班，所以每一班各自標誰搭；不選＝全員 -->
        <div v-if="isFlight">
          <span class="label">誰搭這班（不選＝全員）</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="m in members" :key="m.userId" @click="togglePassenger(m.userId)"
              :class="['chip-state', form.passengerIds.includes(m.userId) && 'on']">
              <Avatar :user="m.user" :size="18" />{{ m.user?.name ?? '成員' }}
            </button>
          </div>
        </div>

        <!-- 住宿是唯一跨多天的：自己帶入住日與退房日，不靠日期列決定 -->
        <div v-if="isStay" class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="e-in">入住日</label>
            <input id="e-in" v-model="form.startDate" type="date" class="input" />
          </div>
          <div>
            <label class="label" for="e-out">退房日</label>
            <input id="e-out" v-model="form.endDate" type="date" class="input" :min="stayStart" />
          </div>
        </div>
        <p v-if="badStayRange" class="-mt-1 text-[12px] text-danger">退房日不能早於入住日</p>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="e-start">{{ isFlight ? '起飛時間（選填）' : isStay ? '入住時間（選填）' : '開始時間（選填）' }}</label>
            <input id="e-start" v-model="form.startTime" type="time" class="input" />
          </div>
          <div>
            <label class="label" for="e-end">{{ isFlight ? '抵達時間（選填）' : isStay ? '退房時間（選填）' : '結束時間（選填）' }}</label>
            <input id="e-end" v-model="form.endTime" type="time" class="input" />
          </div>
        </div>
        <p v-if="badTimes" class="-mt-1 text-[12px] text-danger">結束時間不能早於開始時間</p>
        <p v-else-if="isFlight && form.startTime && form.endTime && form.endTime < form.startTime" class="-mt-1 text-[12px] text-muted">
          抵達時間比起飛早，會標示成隔天抵達
        </p>

        <div>
          <label class="label" for="e-note">備註（選填）</label>
          <textarea id="e-note" v-model="form.note" class="input h-28 resize-y py-2.5" maxlength="2000"
            :placeholder="isFlight ? '訂位代號、航廈、行李額度…' : isStay ? '訂房代號、地址、早餐時間、寄放行李…' : '只屬於這一天，不會寫回清單的地點'" />
        </div>

        <!-- 從清單帶過來的連結也在這裡改，改了不會回寫清單 -->
        <div>
          <span class="label">連結（選填，最多 {{ MAX_LINKS }} 個）</span>
          <div v-if="form.links.length" class="grid gap-2">
            <div v-for="(l, i) in form.links" :key="l.id" class="overflow-hidden rounded-xl border border-line bg-card p-2.5">
              <div class="flex items-center gap-2">
                <input v-model="l.title" class="input h-9 min-w-0 flex-1" maxlength="40" placeholder="連結標題（選填）" />
                <button class="icon-btn size-8 shrink-0 text-muted" aria-label="移除這個連結" @click="form.links.splice(i, 1)"><PhX :size="16" /></button>
              </div>
              <input v-model="l.url" type="url" inputmode="url" class="input mt-2 h-9" placeholder="貼上 Google Maps、IG 或網頁連結"
                @blur="onUrl(l)" @paste="onPaste(l)" />
              <p v-if="previews[l.id]?.state === 'loading'" class="mt-1.5 px-1 text-[12px] text-muted">正在取得預覽…</p>
              <p v-else-if="previews[l.id]?.state === 'fail'" class="mt-1.5 px-1 text-[12px] text-danger">無法取得預覽，可以手動填標題</p>
              <div v-else-if="l.url.trim()" class="mt-1.5 flex items-baseline gap-2 px-1">
                <span class="shrink-0 text-[12px] text-muted">{{ sourceLabel(l.url) }}</span>
                <button v-if="previews[l.id]?.data?.description" class="truncate text-[12px] font-medium text-accent" @click="addDesc(l)">加入備註</button>
              </div>
            </div>
          </div>
          <button v-if="form.links.length < MAX_LINKS" class="btn-ghost mt-2 h-9 w-full text-[14px]" @click="addFormLink">
            <PhPlus :size="16" weight="bold" />新增連結
          </button>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary h-12 w-full" :disabled="!canSaveForm" @click="submitForm">儲存</button>
      </template>
    </Sheet>

    <!-- 卡片選單 -->
    <Sheet :open="!!entryMenu" :title="entryMenu ? entryTitle(entryMenu) : ''" @update:open="v => !v && (entryMenu = null)">
      <!-- 卡片上的備註是截斷的，抽屜裡給完整內容 -->
      <p v-if="entryMenu?.note" class="mb-1 max-h-48 overflow-auto whitespace-pre-line border-b border-line px-3 pb-3 text-[14px] leading-relaxed text-muted">{{ entryMenu.note }}</p>
      <!-- 真的 <a>：手機上 Google Maps 連結要能跳到地圖 App（F-15） -->
      <div v-if="entryMenu?.links?.length" class="mb-1 border-b border-line pb-1">
        <a v-for="l in entryMenu.links" :key="l.id" :href="l.url" target="_blank" rel="noopener" class="row" @click="entryMenu = null">
          <PhArrowSquareOut :size="20" class="shrink-0 text-accent" />
          <span class="min-w-0 flex-1 truncate">{{ linkLabel(l) }}</span>
          <span v-if="l.title?.trim()" class="shrink-0 text-[13px] text-muted">{{ sourceLabel(l.url) }}</span>
        </a>
      </div>
      <p v-if="entryMenu?.kind === 'stay'" class="px-3 pb-2 text-[13px] tabular-nums text-muted">
        {{ entryMenu.date.slice(5).replace('-', '/') }} 入住 → {{ entryMenu.endDate.slice(5).replace('-', '/') }} 退房・共 {{ stayNights(entryMenu) }} 晚
      </p>
      <button class="row" :disabled="store.offline" @click="openEdit(entryMenu); entryMenu = null">
        <PhPencilSimple :size="20" class="text-muted" />
        <span class="flex-1">{{ entryMenu?.kind === 'stay' ? '編輯住宿（含日期）' : '編輯時間、備註與連結' }}</span>
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
      <!-- 住宿的日期在自己的表單裡改，不走搬移 -->
      <button v-if="entryMenu?.kind !== 'stay'" class="row" :disabled="store.offline" @click="openMove(entryMenu)">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">搬到其他天或時段</span>
      </button>
      <!-- 住宿自己成一區、跨多天，不會出現在任何時段裡。但「傍晚回飯店 check-in」
           「早上退房寄行李」是真的要排進某個時段的事 -->
      <button v-else class="row" :disabled="store.offline" @click="openStayInto(entryMenu)">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">加到某天的時段</span>
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
        <!-- 選了只是選起來，真的搬要按下面那顆 -->
        <div class="flex flex-wrap gap-2">
          <button v-for="d in days" :key="d.date"
            :class="['chip-region', moveTo?.date === d.date && 'on']"
            @click="moveTo = { ...moveTo, date: d.date }">
            {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
          </button>
        </div>
        <!-- 航班自己成一區，沒有時段可選 -->
        <template v-if="moveFor?.kind !== 'flight'">
          <p class="mb-2 mt-4 text-[13px] font-semibold">時段</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="[slot, label] in SLOTS" :key="slot"
              :class="['chip-state', moveTo?.section === 'schedule' && moveTo?.slot === slot && 'on']"
              @click="moveTo = { ...moveTo, section: 'schedule', slot }">{{ label }}</button>
          </div>
          <p class="mb-2 mt-4 text-[13px] font-semibold">餐別</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="[slot, label] in MEALS" :key="slot"
              :class="['chip-state', moveTo?.section === 'meal' && moveTo?.slot === slot && 'on']"
              :disabled="moveFor?.kind !== 'place'"
              @click="moveTo = { ...moveTo, section: 'meal', slot }">{{ label }}</button>
          </div>
          <p v-if="moveFor?.kind === 'transport'" class="mt-2 text-[12px] text-muted">交通項目不能放進餐食備選。</p>
        </template>
      </div>

      <template #footer>
        <button class="btn-primary w-full" :disabled="!moveChanged" @click="doMove">
          {{ moveChanged ? `搬到 ${moveLabel}` : '選一個新的位置' }}
        </button>
      </template>
    </Sheet>

    <!-- 住宿 → 某天的時段。跟「搬到」一樣是選好再按確定，不要點了就送出 -->
    <Sheet :open="!!stayInto" :title="stayInto ? `加到時段：${entryTitle(stayInto)}` : ''"
      @update:open="v => !v && (stayInto = null)">
      <div class="px-2 pb-2">
        <p class="mb-2 mt-1 text-[13px] font-semibold">日期</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="d in days" :key="d.date"
            :class="['chip-region', stayTo?.date === d.date && 'on']"
            @click="stayTo = { ...stayTo, date: d.date }">
            {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
          </button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">時段</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in SLOTS" :key="slot"
            :class="['chip-state', stayTo?.slot === slot && 'on']"
            @click="stayTo = { ...stayTo, slot }">{{ label }}</button>
        </div>
        <p class="mt-3 text-[12px] leading-relaxed text-muted">會複製住宿名稱與連結過去，之後各改各的。住宿本身還是留在住宿區。</p>
      </div>

      <template #footer>
        <button class="btn-primary w-full" @click="doStayInto">加到 {{ stayIntoLabel }}</button>
      </template>
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
