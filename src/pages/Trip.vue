<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPlus, PhDotsThreeVertical, PhMagnifyingGlass, PhUsersThree, PhWifiSlash, PhCheck, PhX, PhSlidersHorizontal,
  PhCopy, PhUsersThree as PhShared, PhPencilSimple, PhTrash, PhArrowSquareOut } from '@phosphor-icons/vue'
import { store, trip, prefs, tripMembers, user, me, isOwner, regionsOf, setStatus, copyItem, deleteItem, toast, now, fmtTime, tagColor, sourceLabel, linkLabel } from '../store'
import TopBar from '../components/TopBar.vue'
import Avatar from '../components/Avatar.vue'
import ItemCard from '../components/ItemCard.vue'
import Sheet from '../components/Sheet.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const t = computed(() => trip(tripId))
if (!t.value) router.replace('/')
const p = prefs(tripId) // F-09 / F-24: tab, type and filters remembered locally
// ?tab=me|shared from the copy toast; same component instance, so watch instead of reading once.
watch(() => route.query.tab, tab => { if (tab) { p.tab = tab; router.replace({ query: {} }) } }, { immediate: true })
if (!store.offline) store.syncedAt = now()

const others = computed(() => tripMembers(tripId).filter(m => m.userId !== store.me)
  .sort((a, b) => (a.status === 'left') - (b.status === 'left') || a.joinedAt.localeCompare(b.joinedAt)))
const tabOwner = computed(() => (p.tab === 'shared' ? null : p.tab === 'me' ? store.me : p.tab))
const editable = computed(() => tabOwner.value === null || tabOwner.value === store.me)
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
function add() { store.offline ? toast('需要網路') : router.push({ path: `/trips/${tripId}/items/new`, query: { type: p.type, tab: p.tab, region: p.region } }) }
function pickStatus(s) { setStatus(statusFor.value, { status: s }); statusFor.value = null }

// F-12 複製 / F-17 刪除。離線時只允許切換狀態（F-33），其餘寫入一律擋掉。
function copy(target) {
  const it = itemMenu.value
  itemMenu.value = null
  copyItem(it, target)
  toast(target === 'shared' ? '已複製到共同分頁' : '已複製到我的分頁', { label: '前往', to: { path: `/trips/${tripId}`, query: { tab: target } } })
}
function edit() {
  const it = itemMenu.value
  itemMenu.value = null
  router.push(`/trips/${tripId}/items/${it.id}/edit`)
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
  <template v-if="t">
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

    <!-- 常駐的「你在哪」：分頁（誰）＋ 子清單（什麼）。進度條是 2px 底線，不另佔一行。 -->
    <div class="sticky top-14 z-10 bg-surface">
      <nav class="rail flex gap-5">
        <button :class="tabCls('shared')" @click="p.tab = 'shared'"><PhUsersThree :size="18" />共同</button>
        <button :class="tabCls('me')" @click="p.tab = 'me'"><Avatar :user="me()" :size="20" />我的</button>
        <button v-for="m in others" :key="m.userId" :class="[tabCls(m.userId), m.status === 'left' && 'opacity-50']" @click="p.tab = m.userId">
          <Avatar :user="user(m.userId)" :size="20" />{{ user(m.userId).name }}<span v-if="m.status === 'left'">（已離開）</span>
        </button>
      </nav>

      <div class="gutter pb-2 pt-2">
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

      <div class="h-px w-full bg-line">
        <div v-if="scoped.length" class="h-px bg-accent transition-[width] duration-200 ease-out"
          :style="{ width: (done / scoped.length) * 100 + '%' }" role="progressbar" :aria-valuenow="done" :aria-valuemax="scoped.length"
          :aria-label="`${p.type === 'shopping' ? '已買' : '已去'} ${done} / ${scoped.length}`" />
      </div>

      <!-- 只有真的在篩選時才出現這一行，沒篩選就零成本 -->
      <div v-if="activeFilters.length" class="gutter flex items-center gap-2 border-b border-line py-2 text-[13px]">
        <span class="min-w-0 flex-1 truncate text-muted">已篩選：{{ activeFilters.map(f => f.label).join('・') }}</span>
        <button class="shrink-0 font-semibold text-accent" @click="clearFilters">清除</button>
      </div>
    </div>

    <main class="gutter pb-32 pt-4">
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
              <ItemCard :item="i" :editable="editable" :show-author="tabOwner === null"
                @status="statusFor = i" @visited="setStatus(i, { visited: !i.visited })" @menu="itemMenu = i" />
            </li>
          </TransitionGroup>
        </section>
      </template>
    </main>

    <button v-if="editable" aria-label="新增" @click="add"
      :class="['fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[max(1.5rem,calc(50vw-360px+1.5rem))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-e2 transition duration-150 active:scale-90', store.offline && 'opacity-40']">
      <PhPlus :size="26" weight="bold" />
    </button>

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
      <button class="row" :disabled="itemMenu?.ownerUserId === store.me || store.offline" @click="copy('me')">
        <PhCopy :size="20" class="text-muted" /><span class="flex-1">複製到我的分頁</span>
      </button>
      <button class="row" :disabled="itemMenu?.ownerUserId === null || store.offline" @click="copy('shared')">
        <PhShared :size="20" class="text-muted" /><span class="flex-1">複製到共同分頁</span>
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
