<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhDotsThreeVertical, PhMagnifyingGlass, PhWifiSlash, PhCheck, PhX, PhSlidersHorizontal,
  PhCopy, PhPencilSimple, PhTrash, PhArrowSquareOut, PhCalendarBlank, PhListChecks } from '@phosphor-icons/vue'
import { store, trip, prefs, tripMembers, user, me, isOwner, regionsOf, setStatus, copyItem, deleteItem, toast, now, fmtTime, tagColor, sourceLabel, linkLabel,
  tripDays, addEntry, entryFromItem, scheduledSlots } from '../store'
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
// F-25: tags on this tab merged by name
const tagNames = computed(() => [...new Set(scoped.value.flatMap(i => i.tagIds.map(id => store.tags.find(g => g.id === id)?.name)).filter(Boolean))])

const STATUS = { shopping: [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']], place: [['unvisited', '未去'], ['visited', '已去過']] }
const ORDER = { todo: 0, not_found: 1, bought: 2 }
const filtered = computed(() => scoped.value.filter(i =>
  (p.region === 'all' || (p.region === 'none' ? !i.regionId : i.regionId === p.region)) &&
  (!p.status || (p.type === 'shopping' ? i.status === p.status : (p.status === 'visited') === i.visited)) &&
  (!p.tag || i.tagIds.some(id => store.tags.find(g => g.id === id)?.name === p.tag)) &&
  (!p.q || [i.title, i.note, i.plannedStore].join(' ').toLowerCase().includes(p.q.toLowerCase())),
).sort((a, b) => (p.type === 'shopping' ? ORDER[a.status] - ORDER[b.status] : a.visited - b.visited) || b.createdAt.localeCompare(a.createdAt)))

const groups = computed(() => p.region !== 'all'
  ? [{ key: 'flat', items: filtered.value }]
  : [...regions.value.map(r => ({ key: r.id, name: r.name, items: filtered.value.filter(i => i.regionId === r.id) })),
     { key: 'none', name: '未分類', items: filtered.value.filter(i => !i.regionId) }].filter(g => g.items.length))
const done = computed(() => scoped.value.filter(i => (p.type === 'shopping' ? i.status === 'bought' : i.visited)).length)
const hasFilter = computed(() => p.region !== 'all' || p.status || p.tag || p.q)

const showSearch = ref(!!p.q), menu = ref(false), statusFor = ref(null), itemMenu = ref(null), filterOpen = ref(false)

// 已套用的篩選，攤平成一串好顯示、每個都能單獨取消
const activeFilters = computed(() => {
  const out = []
  if (p.region !== 'all') out.push({ k: 'region', label: p.region === 'none' ? '未分類' : regions.value.find(r => r.id === p.region)?.name ?? '', clear: () => (p.region = 'all') })
  if (p.status) out.push({ k: 'status', label: STATUS[p.type].find(([k]) => k === p.status)?.[1] ?? '', clear: () => (p.status = '') })
  if (p.tag) out.push({ k: 'tag', label: p.tag, clear: () => (p.tag = '') })
  if (p.q) out.push({ k: 'q', label: `「${p.q}」`, clear: () => { p.q = ''; showSearch.value = false } })
  return out
})

function clearFilters() { Object.assign(p, { region: 'all', status: '', tag: '', q: '' }); showSearch.value = false }
function setType(type) { if (p.type !== type) { p.type = type; p.status = '' } }
function toggle(key, v) { p[key] = p[key] === v ? '' : v }
function toggleSearch() { showSearch.value = !showSearch.value; if (!showSearch.value) p.q = '' }
function add() { store.offline ? toast('需要網路') : router.push({ path: `/trips/${tripId}/items/new`, query: { type: p.type, region: p.region } }) }
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
const addFor = ref(null)   // { item, date }
function addToItinerary() {
  const it = itemMenu.value
  itemMenu.value = null
  addFor.value = { item: it, date: (days.value.find(d => d.isToday) ?? days.value[0])?.date ?? '' }
}
function placeIntoItinerary(section, slot) {
  const { item: it, date } = addFor.value
  addEntry(entryFromItem(it, { tripId, date, section, slot }))
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
    <div class="sticky top-14 z-10 bg-surface">
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
        <div class="relative grid grid-cols-2 rounded-[12px] bg-surface-2 p-1">
          <div class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-[9px] bg-card shadow-e1 transition-transform duration-200 ease-out"
            :style="{ transform: p.type === 'shopping' ? 'translateX(100%)' : 'none' }" aria-hidden="true" />
          <button v-for="[k, l] in [['place', '地點'], ['shopping', '購物']]" :key="k"
            :class="['relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-semibold transition-colors duration-150', p.type === k ? 'text-ink' : 'text-muted']"
            @click="setType(k)">
            {{ l }}
            <span v-if="tally(k).total" class="text-[12px] font-normal tabular-nums opacity-70">{{ tally(k).done }}/{{ tally(k).total }}</span>
          </button>
        </div>
      </div>

      <div v-if="!onItinerary" class="h-px w-full bg-line">
        <div v-if="scoped.length" class="h-px bg-accent transition-[width] duration-200 ease-out"
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
        <p class="text-[17px] font-semibold">{{ p.type === 'shopping' ? '還沒有購物項目' : '還沒有地點' }}</p>
        <p class="mt-1.5 text-[14px] text-muted">{{ editable ? '按右下角的加號新增第一個。' : '這個分頁還沒有內容。' }}</p>
      </div>
      <div v-else-if="!filtered.length" class="mt-14 text-center">
        <p class="text-[17px] font-semibold">沒有符合的項目</p>
        <button v-if="hasFilter" class="btn-ghost mt-6" @click="clearFilters">清除篩選</button>
      </div>
      <template v-else>
        <section v-for="g in groups" :key="g.key" class="mb-6">
          <h2 v-if="g.name" class="mb-2.5 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted">
            <span class="size-1.5 rounded-full bg-tint" aria-hidden="true" />{{ g.name }}
            <span class="font-normal tabular-nums">{{ g.items.length }}</span>
          </h2>
          <TransitionGroup tag="ul" name="list" class="relative grid gap-3">
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

    <!-- F-41：從清單加入行程，選日期再選時段或餐別 -->
    <Sheet :open="!!addFor" :title="addFor ? `加入行程：${addFor.item.title}` : ''" @update:open="v => !v && (addFor = null)">
      <div class="px-2 pb-2">
        <p class="mb-2 mt-1 text-[13px] font-semibold">日期</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="d in days" :key="d.date" :class="['chip-region', addFor?.date === d.date && 'on']"
            @click="addFor = { ...addFor, date: d.date }">
            {{ d.date.slice(5).replace('-', '/') }}（{{ d.weekday }}）
          </button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">時段</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in SLOTS" :key="slot" class="chip-state" @click="placeIntoItinerary('schedule', slot)">{{ label }}</button>
        </div>
        <p class="mb-2 mt-4 text-[13px] font-semibold">餐別</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="[slot, label] in MEALS" :key="slot" class="chip-state" @click="placeIntoItinerary('meal', slot)">{{ label }}</button>
        </div>
      </div>
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
          <button :class="['chip-region', p.region === 'all' && 'on']" @click="p.region = 'all'">全部</button>
          <button v-for="r in regions" :key="r.id" :class="['chip-region', p.region === r.id && 'on']" @click="p.region = r.id">{{ r.name }}</button>
          <button :class="['chip-region', p.region === 'none' && 'on']" @click="p.region = 'none'">未分類</button>
        </div>

        <h3 class="mb-2 mt-5 text-[15px] font-semibold">{{ p.type === 'shopping' ? '購買狀態' : '去過了嗎' }}</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="[k, l] in STATUS[p.type]" :key="k" :class="['chip-state', p.status === k && 'on']" @click="toggle('status', k)">{{ l }}</button>
        </div>

        <template v-if="tagNames.length">
          <h3 class="mb-2 mt-5 text-[15px] font-semibold">標籤</h3>
          <div class="flex flex-wrap gap-2">
            <button v-for="n in tagNames" :key="n" :class="['chip-tag', tagColor(n), p.tag === n && 'on']" @click="toggle('tag', n)">{{ n }}</button>
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
