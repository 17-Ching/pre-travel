<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhDotsThreeVertical, PhMagnifyingGlass, PhWifiSlash, PhCheck, PhX, PhSlidersHorizontal,
  PhCopy, PhPencilSimple, PhTrash, PhArrowSquareOut, PhCalendarBlank, PhListChecks, PhCaretRight } from '@phosphor-icons/vue'
import { store, trip, prefs, tripMembers, user, me, isOwner, regionsOf, setStatus, copyItem, deleteItem, toast, now, fmtTime, tagColor, sourceLabel, linkLabel,
  tripDays, addEntry, entryFromItem, scheduledSlots, tagScope, openGroups } from '../store'
import TopBar from '../components/TopBar.vue'
import Avatar from '../components/Avatar.vue'
import LoadState from '../components/LoadState.vue'
import ItemCard from '../components/ItemCard.vue'
import Itinerary from '../components/Itinerary.vue'
import Sheet from '../components/Sheet.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const t = computed(() => trip(tripId))
// 這裡以前是 `if (!t.value) router.replace('/')`。不能在 setup 裡同步跳轉：
// store 還沒載完時一定會踩到（專案當然找不到），而且會跟邀請頁正在進行的
// router.replace 撞在一起，結果是畫面停在一個點不動的狀態，要上一頁再返回才好。
// 改成用畫面表達：沒載完顯示載入中，載完真的找不到才顯示找不到，都不導航。
const missing = computed(() => store.ready && !store.loading && !store.loadError && !t.value)
const p = prefs(tripId) // F-09 / F-24: tab, type and filters remembered locally
// 舊的 prefs 只有一個 tab，值可能是 'shared'（v2.0 移除）、'me' 或某個成員 id。
// 現在分兩層：tab 只有願望清單／行程，「看誰的清單」記在 who。
if (p.tab !== 'list' && p.tab !== 'itinerary') { p.who = p.tab === 'shared' ? 'me' : p.tab; p.tab = 'list' }
p.who ??= 'me'
// ?tab= / ?who= 來自複製與加入行程的 toast；同一個元件實例，所以用 watch 不是讀一次
watch(() => route.query, q => {
  if (!q.tab && !q.who) return
  if (q.tab) p.tab = q.tab
  if (q.who) p.who = q.who
  router.replace({ query: {} })
}, { immediate: true })
if (!store.offline) store.syncedAt = now()

const others = computed(() => tripMembers(tripId).filter(m => m.userId !== store.me)
  .sort((a, b) => (a.status === 'left') - (b.status === 'left') || a.joinedAt.localeCompare(b.joinedAt)))
const onItinerary = computed(() => p.tab === 'itinerary')
const tabOwner = computed(() => (p.who === 'me' ? store.me : p.who))
const editable = computed(() => tabOwner.value === store.me)
const regions = computed(() => regionsOf(tripId))
const scoped = computed(() => store.items.filter(i => i.tripId === tripId && i.ownerUserId === tabOwner.value && i.type === p.type))
// 篩選用「標籤名稱」不是 id：同一個名字在每個成員名下是各自獨立的一筆（F-22），
// 看別人的清單時要能照他的標籤篩，比對 id 會是空的。
// （原本掛在 F-25 底下，那條隨共同分頁在 v2.0 刪掉了，但比對名稱這件事留著才對。）
const tagNames = computed(() => [...new Set(scoped.value.flatMap(i => i.tagIds.map(id => store.tags.find(g => g.id === id)?.name)).filter(Boolean))])

const STATUS = { shopping: [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']], place: [['unvisited', '未去'], ['visited', '已去過']] }
// 參考（影片、貼文）沒有完成狀態：看過了不代表就沒用了。所以它沒有狀態篩選、
// 沒有進度條、segment 上只顯示數量。下面凡是查 STATUS[p.type] 的地方都要擋這個情況。
const TYPES = [['place', '地點'], ['shopping', '購物'], ['reference', '參考']]
const hasStatus = computed(() => Boolean(STATUS[p.type]))
const ORDER = { todo: 0, not_found: 1, bought: 2 }
// 地區與標籤都是複選：同一組之內是「或」（選了東京和大阪＝兩邊都看得到），
// 組與組之間仍然是「且」。沒選＝不篩，不是「都不符合」。
// 未分類用 'none' 當假 id 混在 regions 裡，不用再開一個欄位記它。
const toggleIn = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1) }
const tagNameOf = id => store.tags.find(g => g.id === id)?.name

const filtered = computed(() => scoped.value.filter(i =>
  (!p.regions.length || p.regions.includes(i.regionId ?? 'none')) &&
  (!p.status || (p.type === 'shopping' ? i.status === p.status : (p.status === 'visited') === i.visited)) &&
  (!p.tags.length || i.tagIds.some(id => p.tags.includes(tagNameOf(id)))) &&
  (!p.q || [i.title, i.note, i.plannedStore].join(' ').toLowerCase().includes(p.q.toLowerCase())),
).sort((a, b) => (p.type === 'shopping' ? ORDER[a.status] - ORDER[b.status] : a.visited - b.visited) || b.createdAt.localeCompare(a.createdAt)))

// 地點與購物照地區分組。以前只篩一個地區時會改成無標題的平鋪，但複選兩個地區時平鋪
// 就看不出哪筆屬於哪一區了；空的組本來就會被濾掉，所以只選一個時結果一樣乾淨。
//
// 參考照標籤分組：要拍的 reels 大多沒有地區，照地區分會全擠在「未分類」一組。
// 一筆有兩個標籤就兩組都出現 —— 一支同時是轉場與拍食物的 reel 對兩個分類都有用，
// 只放「第一個標籤」那組會很隨機。正在篩標籤時只列被選的那幾組，不然篩「轉場」
// 還會冒出一組「拍食物」（因為那筆兩個都有）。組名排序固定，新增項目時組不會跳來跳去。
const groups = computed(() => {
  const keep = g => g.items.length
  if (p.type !== 'reference') {
    return [...regions.value.map(r => ({ key: r.id, name: r.name, items: filtered.value.filter(i => i.regionId === r.id) })),
      { key: 'none', name: '未分類', items: filtered.value.filter(i => !i.regionId) }].filter(keep)
  }
  const names = (p.tags.length ? tagNames.value.filter(n => p.tags.includes(n)) : tagNames.value)
    .slice().sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  return [...names.map(n => ({ key: 'tag-' + n, name: n, items: filtered.value.filter(i => i.tagIds.some(id => tagNameOf(id) === n)) })),
    { key: 'untagged', name: '沒有標籤', items: filtered.value.filter(i => !i.tagIds.some(tagNameOf)) }].filter(keep)
})
const done = computed(() => scoped.value.filter(i => (p.type === 'shopping' ? i.status === 'bought' : i.visited)).length)
const hasFilter = computed(() => p.regions.length || p.status || p.tags.length || p.q)

// 分組可以收合，預設收著。兩種情況強制全部攤開、也不給收：
//  - 正在篩選或搜尋：收著的組會把命中的項目藏起來，畫面上只剩一個寫著數字的標題，
//    篩選等於白做。清掉篩選後回到原本收合的樣子，不動使用者的展開狀態。
//  - 只有一組：沒有東西需要整理，收起來只是多點一下。
const groupKey = g => `${tripId}:${p.type}:${g.key}`
const forceOpen = computed(() => Boolean(hasFilter.value) || groups.value.length === 1)
const isOpen = g => forceOpen.value || openGroups.has(groupKey(g))
const toggleGroup = g => { const k = groupKey(g); openGroups.has(k) ? openGroups.delete(k) : openGroups.add(k) }

const showSearch = ref(!!p.q), menu = ref(false), statusFor = ref(null), itemMenu = ref(null), filterOpen = ref(false)

// 已套用的篩選，攤平成一串好顯示、每個都能單獨取消
const activeFilters = computed(() => {
  const out = []
  for (const id of p.regions) {
    out.push({ k: 'region-' + id, label: id === 'none' ? '未分類' : regions.value.find(r => r.id === id)?.name ?? '', clear: () => toggleIn(p.regions, id) })
  }
  if (p.status) out.push({ k: 'status', label: STATUS[p.type]?.find(([k]) => k === p.status)?.[1] ?? '', clear: () => (p.status = '') })
  for (const n of p.tags) out.push({ k: 'tag-' + n, label: n, clear: () => toggleIn(p.tags, n) })
  if (p.q) out.push({ k: 'q', label: `「${p.q}」`, clear: () => { p.q = ''; showSearch.value = false } })
  return out
})

function clearFilters() { Object.assign(p, { regions: [], status: '', tags: [], q: '' }); showSearch.value = false }
function setType(type) {
  if (p.type === type) return
  // 跨池（地點/購物 ↔ 參考）時清掉標籤篩選：兩池的標籤各自獨立，帶過去的話會拿
  // 地點的「拉麵」去篩參考，結果整片空白，篩選抽屜裡又看不到那顆可以取消。
  if (tagScope(type) !== tagScope(p.type)) p.tags = []
  p.type = type
  p.status = ''
  // 換子清單等於整份內容換掉，停在原本的捲動位置會落在不相干的地方（而且兩邊項目數
  // 常常差很多，捲到一半直接看到空白）
  scrollTo({ top: 0 })
}

// 地區標題 sticky。它要黏在上面那一整塊（分頁＋看誰的＋地點/購物＋已篩選）下面，
// 而那塊的高度是會變的 —— 有沒有其他成員、有沒有正在篩選都會多一列。
// 所以量它，不要寫死一個 px：寫死的話多一列就被蓋住，少一列就浮著一條縫。
const headEl = ref()
const headH = ref(0)
let ro
watch(headEl, el => {
  ro?.disconnect()
  if (!el) return
  ro = new ResizeObserver(() => (headH.value = el.offsetHeight))
  ro.observe(el)
  headH.value = el.offsetHeight
})
onUnmounted(() => ro?.disconnect())
function toggle(key, v) { p[key] = p[key] === v ? '' : v }
function toggleSearch() { showSearch.value = !showSearch.value; if (!showSearch.value) p.q = '' }
// 只篩一個地區時，新增的項目預設就填那一區；篩多區或沒篩就不猜
function add() {
  if (store.offline) return toast('需要網路')
  const only = p.regions.length === 1 ? p.regions[0] : ''
  router.push({ path: `/trips/${tripId}/items/new`, query: { type: p.type, region: only } })
}
function pickStatus(s) { setStatus(statusFor.value, { status: s }); statusFor.value = null }

// F-12 複製 / F-17 刪除。離線時只允許切換狀態（F-33），其餘寫入一律擋掉。
// v2.0：共同分頁沒了，複製目標只剩「我的清單」，copyItem 也只收一個參數。
function copy() {
  const it = itemMenu.value
  itemMenu.value = null
  copyItem(it)
  toast('已複製到我的清單', { label: '前往', to: { path: `/trips/${tripId}`, query: { tab: 'list', who: 'me' } } })
}
function edit() {
  const it = itemMenu.value
  itemMenu.value = null
  router.push(`/trips/${tripId}/items/${it.id}/edit`)
}

// F-41 從清單這一側加入行程：選日期 → 選時段或餐別
const SLOTS = [['morning', '早上'], ['afternoon', '下午'], ['evening', '晚上']]
const MEALS = [['breakfast', '早餐'], ['lunch', '午餐'], ['snack', '點心'], ['dinner', '晚餐'], ['late_night', '宵夜']]
const days = computed(() => tripDays(tripId))
// 要加的項目與選好的位置分開放，跟行程頁的「搬到」一致：選一選，按確定才真的加
const addFor = ref(null)   // 要加入行程的項目
const addTo = ref(null)    // { date, section, slot }
function addToItinerary() {
  const it = itemMenu.value
  itemMenu.value = null
  addFor.value = it
  addTo.value = { date: (days.value.find(d => d.isToday) ?? days.value[0])?.date ?? '', section: '', slot: '' }
}
// 日期有預設，時段／餐別沒有 —— 沒選就不給按，不然不知道要加到哪裡
const addReady = computed(() => Boolean(addTo.value?.date && addTo.value?.slot))
const addLabel = computed(() => {
  const t = addTo.value
  if (!addReady.value) return ''
  const d = days.value.find(x => x.date === t.date)
  const day = d ? `${d.date.slice(5).replace('-', '/')}（${d.weekday}）` : t.date
  return `${day} ${[...SLOTS, ...MEALS].find(([k]) => k === t.slot)?.[1] ?? ''}`
})
function placeIntoItinerary() {
  const { date, section, slot } = addTo.value
  addEntry(entryFromItem(addFor.value, { tripId, date, section, slot }))
  addFor.value = null
  toast('已加入行程', { label: '前往', to: { path: `/trips/${tripId}`, query: { tab: 'itinerary' } } })
}
function remove() {
  const it = itemMenu.value
  if (!confirm(`刪除「${it.title}」？`)) return
  itemMenu.value = null
  deleteItem(it.id)
  toast('已刪除')
}
// F-21 / F-36：兩個子清單的完成數都直接標在 segment 上，不另外佔一行
const tally = type => {
  const list = store.items.filter(i => i.tripId === tripId && i.ownerUserId === tabOwner.value && i.type === type)
  return { done: list.filter(i => (type === 'shopping' ? i.status === 'bought' : i.visited)).length, total: list.length }
}
const tabCls = id => ['relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 text-[14px] whitespace-nowrap transition-colors duration-150',
  p.tab === id ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted']
</script>

<template>
  <!-- 還沒載完 / 載入失敗：顯示狀態，不要當成「查無此專案」 -->
  <template v-if="!store.ready || store.loading || store.loadError">
    <TopBar title="" back="/" />
    <main class="gutter"><LoadState /></main>
  </template>

  <!-- 載完了才判斷找不到。刻意不自動導頁，讓使用者自己決定要不要離開 -->
  <template v-else-if="missing">
    <TopBar title="" back="/" />
    <main class="gutter mt-24 text-center">
      <p class="text-[17px] font-semibold">找不到這個旅程</p>
      <p class="mt-1.5 text-[14px] text-muted">可能已經被刪除，或你不是這個旅程的成員。</p>
      <RouterLink to="/" class="btn-primary mt-6">回旅程列表</RouterLink>
    </main>
  </template>

  <template v-else-if="t">
    <!-- 搜尋直接接管標題列，不再多佔一行 -->
    <TopBar :title="t.name" back="/">
      <template v-if="showSearch" #title>
        <input v-model="p.q" autofocus class="h-9 w-full rounded-full border border-line bg-card px-3.5 text-[16px] outline-none placeholder:text-muted focus:border-accent" placeholder="搜尋標題、備註、購買地點" />
      </template>
      <button class="icon-btn" :class="showSearch && 'text-accent'" :aria-label="showSearch ? '關閉搜尋' : '搜尋'" @click="toggleSearch">
        <component :is="showSearch ? PhX : PhMagnifyingGlass" :size="22" />
      </button>
      <button class="icon-btn" aria-label="更多" @click="menu = true"><PhDotsThreeVertical :size="22" weight="bold" /></button>
    </TopBar>

    <div v-if="store.offline" class="sticky top-14 z-20 flex items-center gap-2 bg-ink px-4 py-2 text-[13px] text-surface">
      <PhWifiSlash :size="16" /><span class="flex-1">離線模式・資料為 {{ fmtTime(store.syncedAt) }} 版本</span>
      <span v-if="store.pending.length">待同步 {{ store.pending.length }} 筆</span>
    </div>

    <!-- 常駐的「你在哪」：分頁（願望清單／行程）＋ 誰的清單 ＋ 子清單（什麼）。
         進度條是 2px 底線，不另佔一行。 -->
    <div ref="headEl" class="sticky top-14 z-10 bg-surface">
      <nav class="rail flex gap-5">
        <button :class="tabCls('list')" @click="p.tab = 'list'"><PhListChecks :size="18" />願望清單</button>
        <button :class="tabCls('itinerary')" @click="p.tab = 'itinerary'"><PhCalendarBlank :size="18" />行程</button>
      </nav>

      <!-- 「看誰的清單」收進願望清單裡，只有真的有別人時才出現 -->
      <div v-if="!onItinerary && others.length" class="rail flex gap-2 pt-2">
        <button :class="['chip-state', p.who === 'me' && 'on']" @click="p.who = 'me'">
          <Avatar :user="me()" :size="18" />我的
        </button>
        <button v-for="m in others" :key="m.userId" @click="p.who = m.userId"
          :class="['chip-state', p.who === m.userId && 'on', m.status === 'left' && 'opacity-50']">
          <Avatar :user="user(m.userId)" :size="18" />{{ user(m.userId).name }}<span v-if="m.status === 'left'">（已離開）</span>
        </button>
      </div>

      <!-- 行程分頁有自己的日期列與版面，下面這整塊是願望清單專用 -->
      <div v-if="!onItinerary" class="gutter pb-2 pt-2">
        <!-- 滑塊寬度＝(容器扣掉左右 padding) / 3，位移是自己寬度的整數倍 -->
        <div class="relative grid grid-cols-3 rounded-[12px] bg-surface-2 p-1">
          <div class="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-[9px] bg-card shadow-e1 transition-transform duration-200 ease-out"
            :style="{ transform: `translateX(${TYPES.findIndex(([k]) => k === p.type) * 100}%)` }" aria-hidden="true" />
          <button v-for="[k, l] in TYPES" :key="k"
            :class="['relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-semibold transition-colors duration-150', p.type === k ? 'text-ink' : 'text-muted']"
            @click="setType(k)">
            {{ l }}
            <!-- 參考沒有「完成」，只顯示數量 -->
            <span v-if="tally(k).total" class="text-[12px] font-normal tabular-nums opacity-70">{{ STATUS[k] ? `${tally(k).done}/${tally(k).total}` : tally(k).total }}</span>
          </button>
        </div>
      </div>

      <div v-if="!onItinerary" class="h-px w-full bg-line">
        <div v-if="scoped.length && hasStatus" class="h-px bg-accent transition-[width] duration-200 ease-out"
          :style="{ width: (done / scoped.length) * 100 + '%' }" role="progressbar" :aria-valuenow="done" :aria-valuemax="scoped.length"
          :aria-label="`${p.type === 'shopping' ? '已買' : '已去'} ${done} / ${scoped.length}`" />
      </div>

      <!-- 只有真的在篩選時才出現這一行，沒篩選就零成本 -->
      <div v-if="!onItinerary && activeFilters.length" class="gutter flex items-center gap-2 border-b border-line py-2 text-[13px]">
        <span class="min-w-0 flex-1 truncate text-muted">已篩選：{{ activeFilters.map(f => f.label).join('・') }}</span>
        <button class="shrink-0 font-semibold text-accent" @click="clearFilters">清除</button>
      </div>
    </div>

    <Itinerary v-if="onItinerary" :trip-id="tripId" />

    <main v-else class="gutter pb-32 pt-4">
      <!-- 篩選入口跟著清單捲動；捲走之後由上面那條 sticky 摘要接手顯示狀態 -->
      <div v-if="scoped.length" class="mb-4 flex items-center gap-3">
        <button aria-label="篩選" :aria-expanded="filterOpen" @click="filterOpen = true"
          :class="['inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold transition duration-150 active:scale-95',
            activeFilters.length ? 'border-ink bg-ink text-surface' : 'border-line bg-card text-ink']">
          <PhSlidersHorizontal :size="16" weight="bold" />篩選
          <span v-if="activeFilters.length" class="ml-0.5 flex size-[18px] items-center justify-center rounded-full bg-accent text-[10px] font-bold tabular-nums text-accent-fg">{{ activeFilters.length }}</span>
        </button>
        <span class="min-w-0 truncate text-[13px] tabular-nums text-muted">{{ filtered.length }} 個項目</span>
      </div>

      <div v-if="!regions.length && !scoped.length && editable" class="mt-14 text-center">
        <p class="text-[17px] font-semibold">先新增第一個地區</p>
        <p class="mt-1.5 text-[14px] leading-relaxed text-muted">例如「東京」「大阪」，之後的地點與購物都能依地區整理。</p>
        <RouterLink :to="`/trips/${tripId}/regions`" class="btn-primary mt-6">新增地區</RouterLink>
      </div>
      <div v-else-if="!scoped.length" class="mt-14 text-center">
        <p class="text-[17px] font-semibold">{{ { place: '還沒有地點', shopping: '還沒有購物項目', reference: '還沒有參考連結' }[p.type] }}</p>
        <p class="mt-1.5 text-[14px] text-muted">{{ editable ? '按右下角的加號新增第一個。' : '這個分頁還沒有內容。' }}</p>
      </div>
      <div v-else-if="!filtered.length" class="mt-14 text-center">
        <p class="text-[17px] font-semibold">沒有符合的項目</p>
        <button v-if="hasFilter" class="btn-ghost mt-6" @click="clearFilters">清除篩選</button>
      </div>
      <template v-else>
        <!-- 收著的組間距縮小，一排框框看起來像目錄；打開的組照舊留 mb-6 -->
        <section v-for="g in groups" :key="g.key" :class="isOpen(g) ? 'mb-6' : 'mb-0'">
          <!-- -mx-4 px-4 讓底色鋪滿整個寬度（main 有 1rem 的 gutter），
               不然卡片會從標題左右兩側的縫隙透出來 -->
          <h2 v-if="g.name" :style="{ top: `calc(3.5rem + ${headH}px)` }"
            :class="['sticky z-[5] -mx-4 bg-surface px-4 py-1 text-[13px] font-semibold tracking-wide text-muted', isOpen(g) && 'mb-1.5']">
            <!-- 整條都是按鈕，加框讓它看得出「這可以點」。篩選中或只有一組時不給收，
                 那時候就只是一行字、不加框 —— 框是在說可以點，不能點就不該有 -->
            <button v-if="!forceOpen" :aria-expanded="isOpen(g)" @click="toggleGroup(g)"
              class="flex w-full items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-2.5 text-left text-[14px] text-ink transition-colors duration-150 active:bg-surface-2">
              <PhCaretRight :size="12" weight="bold" :class="['shrink-0 text-tint transition-transform duration-150', isOpen(g) && 'rotate-90']" />
              <!-- 名稱只吃它需要的寬度（不 flex-1），數量才會緊跟在字後面；
                   太長時名稱自己截斷，數量永遠看得到 -->
              <span class="min-w-0 truncate">{{ g.name }}</span>
              <span class="shrink-0 text-[13px] font-normal tabular-nums text-muted">{{ g.items.length }}</span>
            </button>
            <span v-else class="flex items-center gap-2 py-1.5">
              <span class="size-1.5 rounded-full bg-tint" aria-hidden="true" />{{ g.name }}
              <span class="font-normal tabular-nums">{{ g.items.length }}</span>
            </span>
          </h2>
          <!-- v-show 不是 v-if：收起來不會把卡片拆掉，再打開時圖片不用重載 -->
          <TransitionGroup v-show="isOpen(g)" tag="ul" name="list" class="relative grid gap-3">
            <li v-for="i in g.items" :key="i.id">
              <ItemCard :item="i" :editable="editable" :show-author="false"
                @status="statusFor = i" @visited="setStatus(i, { visited: !i.visited })" @menu="itemMenu = i" />
            </li>
          </TransitionGroup>
        </section>
      </template>
    </main>

    <button v-if="editable && !onItinerary" aria-label="新增" @click="add"
      :class="['fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[max(1.5rem,calc(50vw-360px+1.5rem))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-e2 transition duration-150 active:scale-90', store.offline && 'opacity-40']">
      <PhPlus :size="26" weight="bold" />
    </button>

    <!-- F-41：從清單加入行程。選日期與時段只是選起來，按下面那顆才真的加 -->
    <Sheet :open="!!addFor" :title="addFor ? `加入行程：${addFor.title}` : ''" @update:open="v => !v && (addFor = null)">
      <div class="px-2 pb-2">
        <p class="mb-2 mt-1 text-[13px] font-semibold">日期</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="d in days" :key="d.date" :class="['chip-region', addTo?.date === d.date && 'on']"
            @click="addTo = { ...addTo, date: d.date }">
            {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
          </button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">時段</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in SLOTS" :key="slot"
            :class="['chip-state', addTo?.section === 'schedule' && addTo?.slot === slot && 'on']"
            @click="addTo = { ...addTo, section: 'schedule', slot }">{{ label }}</button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">餐別</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in MEALS" :key="slot"
            :class="['chip-state', addTo?.section === 'meal' && addTo?.slot === slot && 'on']"
            @click="addTo = { ...addTo, section: 'meal', slot }">{{ label }}</button>
        </div>
      </div>

      <template #footer>
        <button class="btn-primary w-full" :disabled="!addReady" @click="placeIntoItinerary">
          {{ addReady ? `加到 ${addLabel}` : '選一個時段或餐別' }}
        </button>
      </template>
    </Sheet>

    <!-- 篩選抽屜：chips 換行並排，不橫向捲動 -->
    <Sheet v-model:open="filterOpen" title="篩選">
      <div class="px-2 pb-2">
        <template v-if="activeFilters.length">
          <h3 class="mb-2 mt-2 text-[15px] font-semibold">已選</h3>
          <div class="flex flex-wrap gap-2">
            <button v-for="f in activeFilters" :key="f.k" class="chip-state on" @click="f.clear()">
              {{ f.label }}<PhX :size="12" weight="bold" />
            </button>
          </div>
          <hr class="my-4 border-line" />
        </template>

        <h3 class="mb-2 text-[15px] font-semibold">地區</h3>
        <div class="flex flex-wrap gap-2">
          <!-- 複選。「全部」是清空，不是另一個選項，所以沒選任何一個時它就是亮的 -->
          <button :class="['chip-region', !p.regions.length && 'on']" @click="p.regions = []">全部</button>
          <button v-for="r in regions" :key="r.id" :class="['chip-region', p.regions.includes(r.id) && 'on']" @click="toggleIn(p.regions, r.id)">{{ r.name }}</button>
          <button :class="['chip-region', p.regions.includes('none') && 'on']" @click="toggleIn(p.regions, 'none')">未分類</button>
        </div>

        <template v-if="hasStatus">
          <h3 class="mb-2 mt-5 text-[15px] font-semibold">{{ p.type === 'shopping' ? '購買狀態' : '去過了嗎' }}</h3>
          <div class="flex flex-wrap gap-2">
            <button v-for="[k, l] in STATUS[p.type]" :key="k" :class="['chip-state', p.status === k && 'on']" @click="toggle('status', k)">{{ l }}</button>
          </div>
        </template>

        <template v-if="tagNames.length">
          <h3 class="mb-2 mt-5 text-[15px] font-semibold">標籤</h3>
          <div class="flex flex-wrap gap-2">
            <button v-for="n in tagNames" :key="n" :class="['chip-tag', tagColor(n), p.tags.includes(n) && 'on']" @click="toggleIn(p.tags, n)">{{ n }}</button>
          </div>
        </template>
      </div>

      <template #footer>
        <div class="flex items-center gap-4">
          <button class="shrink-0 text-[14px] font-medium underline underline-offset-4 disabled:opacity-40" :disabled="!hasFilter" @click="clearFilters">清除全部</button>
          <button class="btn-primary flex-1" @click="filterOpen = false">顯示 {{ filtered.length }} 個項目</button>
        </div>
      </template>
    </Sheet>

    <Sheet v-model:open="menu">
      <RouterLink v-if="isOwner(tripId)" :to="`/trips/${tripId}/edit`" class="row">編輯專案</RouterLink>
      <RouterLink :to="`/trips/${tripId}/members`" class="row">成員與邀請</RouterLink>
      <RouterLink :to="`/trips/${tripId}/regions`" class="row">地區</RouterLink>
      <RouterLink :to="`/trips/${tripId}/tags`" class="row">標籤</RouterLink>
      <label class="row mt-1 border-t border-line pt-1"><span class="flex-1 text-muted">模擬離線（原型用）</span><input v-model="store.offline" type="checkbox" class="size-5 accent-accent" /></label>
    </Sheet>

    <Sheet :open="!!statusFor" title="購買狀態" @update:open="v => !v && (statusFor = null)">
      <button v-for="[k, l] in STATUS.shopping" :key="k" class="row" @click="pickStatus(k)">
        <span class="flex-1">{{ l }}</span><PhCheck v-if="statusFor?.status === k" :size="20" class="text-accent" />
      </button>
    </Sheet>

    <!-- 卡片的動作選單。離線時只有切換狀態可用（F-33），寫入類全部停用 -->
    <Sheet :open="!!itemMenu" :title="itemMenu?.title" @update:open="v => !v && (itemMenu = null)">
      <!-- 每個連結一列。真的 <a>：手機上 Google Maps 連結要能跳到地圖 App（F-15） -->
      <div v-if="itemMenu?.links?.length" class="mb-1 border-b border-line pb-1">
        <a v-for="l in itemMenu.links" :key="l.id" :href="l.url" target="_blank" rel="noopener" class="row" @click="itemMenu = null">
          <PhArrowSquareOut :size="20" class="shrink-0 text-accent" />
          <span class="min-w-0 flex-1 truncate">{{ linkLabel(l) }}</span>
          <span v-if="l.title?.trim()" class="shrink-0 text-[13px] text-muted">{{ sourceLabel(l.url) }}</span>
        </a>
      </div>
      <!-- F-41：清單這一側的「加入行程」入口 -->
      <button v-if="itemMenu?.type === 'place'" class="row" :disabled="store.offline" @click="addToItinerary">
        <PhCalendarBlank :size="20" class="text-muted" /><span class="flex-1">加入行程</span>
      </button>
      <button class="row" :disabled="itemMenu?.ownerUserId === store.me || store.offline" @click="copy">
        <PhCopy :size="20" class="text-muted" /><span class="flex-1">複製到我的清單</span>
      </button>
      <template v-if="editable">
        <button class="row mt-1 border-t border-line pt-1" :disabled="store.offline" @click="edit">
          <PhPencilSimple :size="20" class="text-muted" /><span class="flex-1">編輯</span>
        </button>
        <button class="row text-danger" :disabled="store.offline" @click="remove">
          <PhTrash :size="20" /><span class="flex-1">刪除</span>
        </button>
      </template>
      <p v-if="store.offline" class="px-3 pb-1 pt-2 text-[13px] text-muted">離線中，只能切換狀態</p>
    </Sheet>
  </template>
</template>
