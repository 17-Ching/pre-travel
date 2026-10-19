<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhX, PhPlus } from '@phosphor-icons/vue'
import { store, isBuy, item as getItem, regionsOf, myTags, tagScope, ensureTag, addRegion, saveItem, tagColor,
  MAX_LINKS, newLink, sourceLabel } from '../store'
import { useLinkPreview } from '../link-preview'
import TopBar from '../components/TopBar.vue'
import ImagePicker from '../components/ImagePicker.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const existing = route.params.itemId ? getItem(route.params.itemId) : null
// 三種子清單各自的字眼。用白名單讀 query：網址可以被手改，認不得的一律當地點
const KIND = {
  place: { label: '地點', title: '店名或景點名稱', link: '貼上 Google Maps、IG 或網頁連結', note: '營業時間、要點什麼、注意事項…' },
  shopping: { label: '購物', title: '想買的東西', link: '貼上 Google Maps、IG 或網頁連結', note: '營業時間、要點什麼、注意事項…' },
  // 送禮清單：標題就是「送給誰」，送什麼還沒想好可以先空著寫在備註
  gift: { label: '送禮對象', titleLabel: '送給誰', title: '例：媽媽、辦公室同事', link: '貼上商品頁、IG 或 Google Maps 連結',
    note: '想送什麼、對方的喜好…還沒想好可以先空著' },
  reference: { label: '參考', title: '影片或貼文（例：京都 3 天 2 夜 vlog）', link: '貼上 YouTube、IG、Threads 連結', note: '想參考的段落、時間點、拍攝角度…',
    tag: '輸入分類，例：轉場影片、拍食物' },
}
const type = existing?.type ?? (KIND[route.query.type] ? route.query.type : 'place')
// 參考可以自己放圖（拍照姿勢、構圖），但不自動抓連結預覽圖，見 onUrl
const isRef = type === 'reference'
const qRegion = route.query.region
const f = ref(existing ? JSON.parse(JSON.stringify(existing)) : {
  // v2.0：共同分頁移除（Q8），項目一定進自己的清單分頁
  tripId, type, ownerUserId: store.me,
  title: '', links: [newLink()], regionId: qRegion && qRegion !== 'all' && qRegion !== 'none' ? qRegion : null,
  images: [], note: '', visited: false, status: 'todo', plannedStore: '', tagIds: [],
})

const regions = computed(() => regionsOf(tripId))
// 參考用自己那一池標籤，地點與購物共用另一池
const scope = tagScope(type)
const tags = computed(() => myTags(tripId, scope))
const tagInput = ref('')
const tagExists = computed(() => tags.value.some(g => g.name === tagInput.value.trim()))
function addTag() { const g = ensureTag(tripId, tagInput.value, scope); if (g && !f.value.tagIds.includes(g.id)) f.value.tagIds.push(g.id); tagInput.value = '' }
function toggleTag(id) { const i = f.value.tagIds.indexOf(id); i < 0 ? f.value.tagIds.push(id) : f.value.tagIds.splice(i, 1) }
function onRegion(e) {
  if (e.target.value !== '__new') return (f.value.regionId = e.target.value || null)
  const r = addRegion(tripId, prompt('新地區名稱') || '')
  f.value.regionId = r?.id ?? null
  e.target.value = f.value.regionId ?? ''
}

// F-14 連結預覽。抓取與狀態在 useLinkPreview（行程那邊共用同一支），
// 這裡只做清單專屬的後續：補項目標題、把預覽圖轉存進圖片列。
const { previews, load } = useLinkPreview()
function addLink() { if (f.value.links.length < MAX_LINKS) f.value.links.push(newLink()) }
function removeLink(i) { f.value.links.splice(i, 1) }
async function onUrl(l) {
  const d = await load(l)
  if (!d) return
  // 送禮的標題是人名，不拿商品頁的標題去填
  if (!f.value.title.trim() && type !== 'gift') f.value.title = d.title
  // 預覽圖轉存成自己的副本再放進圖片列，來源網址過期也不會變破圖（F-14）。
  // 參考不自動轉存：參考的圖是使用者自己挑的姿勢、構圖，影片封面塞進來只會佔掉一格
  if (d.image && !isRef) picker.value?.addFromPreview(d.image)
}
const picker = ref()
// paste 事件當下 input 的值還是舊的，要等瀏覽器寫進去才讀得到
const onPaste = l => setTimeout(() => onUrl(l))
function addDesc(l) {
  const d = previews.value[l.id]?.data?.description
  if (d) f.value.note = (f.value.note ? f.value.note + '\n' : '') + d
}

// F-27 圖片的上傳、貼網址、沒存到的檔案清理都在 ImagePicker 裡

const canSave = computed(() => f.value.title.trim())
function save() {
  f.value.links = f.value.links.filter(l => l.url.trim()) // 空白列不存
  saveItem(f.value)
  existing ? router.back() : router.replace(`/trips/${tripId}`)
}
const STATUS = [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']]
</script>

<template>
  <TopBar :title="(existing ? '編輯' : '新增') + KIND[type].label" back />
  <main class="grid gap-5 px-4 pb-32 pt-2">
    <div>
      <label class="label" for="title">{{ KIND[type].titleLabel ?? '標題' }}</label>
      <input id="title" v-model="f.title" class="input" maxlength="100" :placeholder="KIND[type].title" />
    </div>

    <div>
      <span class="label">連結（最多 {{ MAX_LINKS }} 個）</span>
      <div class="grid gap-2">
        <div v-for="(l, i) in f.links" :key="l.id" class="overflow-hidden rounded-xl border border-line bg-card p-2.5">
          <div class="flex items-center gap-2">
            <input v-model="l.title" class="input h-9 min-w-0 flex-1" maxlength="40" placeholder="連結標題（選填）" />
            <button class="icon-btn size-8 shrink-0 text-muted" aria-label="移除這個連結" @click="removeLink(i)"><PhX :size="16" /></button>
          </div>
          <input v-model="l.url" type="url" inputmode="url" class="input mt-2 h-9" :placeholder="KIND[type].link"
            @blur="onUrl(l)" @paste="onPaste(l)" />
          <p v-if="previews[l.id]?.state === 'loading'" class="mt-1.5 px-1 text-[12px] text-muted">正在取得預覽…</p>
          <p v-else-if="previews[l.id]?.state === 'fail'" class="mt-1.5 px-1 text-[12px] text-danger">無法取得預覽，可以手動填標題</p>
          <div v-else-if="l.url.trim()" class="mt-1.5 flex items-baseline gap-2 px-1">
            <span class="shrink-0 text-[12px] text-muted">{{ sourceLabel(l.url) }}</span>
            <button v-if="previews[l.id]?.data?.description" class="truncate text-[12px] font-medium text-accent" @click="addDesc(l)">加入備註</button>
          </div>
        </div>
      </div>
      <button v-if="f.links.length < MAX_LINKS" class="btn-ghost mt-2 h-9 w-full text-[14px]" @click="addLink">
        <PhPlus :size="16" weight="bold" />新增連結
      </button>

    </div>

    <ImagePicker ref="picker" :images="f.images" :trip-id="tripId" :label="isRef ? '參考圖（姿勢、構圖，最多 5 張）' : '圖片（最多 5 張）'" />

    <!-- 送禮不分地區與標籤：要整理的是「送誰」，那就是標題本身 -->
    <div v-if="type !== 'gift'">
      <label class="label" for="region">地區</label>
      <select id="region" class="input" :value="f.regionId ?? ''" @change="onRegion">
        <option value="">未分類</option>
        <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
        <option value="__new">＋ 新增地區…</option>
      </select>
    </div>

    <div v-if="type !== 'gift'">
      <label class="label" for="tag">標籤</label>
      <div v-if="tags.length" class="mb-2 flex flex-wrap gap-1.5">
        <button v-for="g in tags" :key="g.id" @click="toggleTag(g.id)"
          :class="['h-7 rounded-full border px-2.5 text-[13px] font-medium transition', f.tagIds.includes(g.id) ? tagColor(g.name) + ' border-transparent' : 'border-line bg-card text-muted']">{{ g.name }}</button>
      </div>
      <input id="tag" v-model="tagInput" class="input" maxlength="20" :placeholder="KIND[type].tag ?? '輸入新標籤，按 Enter 建立'" @keydown.enter.prevent="tagInput.trim() && addTag()" />
      <button v-if="tagInput.trim() && !tagExists" class="mt-2 text-[13px] font-medium text-accent" @click="addTag">建立「{{ tagInput.trim() }}」</button>
    </div>

    <template v-if="isBuy(type)">
      <div>
        <label class="label" for="store">預計購買地點</label>
        <input id="store" v-model="f.plannedStore" class="input" maxlength="100" placeholder="例：唐吉訶德 道頓堀店" />
      </div>
      <div>
        <span class="label">購買狀態</span>
        <div class="grid grid-cols-3 rounded-xl bg-line p-1">
          <button v-for="[k, l] in STATUS" :key="k" :class="['h-9 rounded-lg text-[14px] font-medium transition', f.status === k ? 'bg-card text-ink shadow-sm' : 'text-muted']" @click="f.status = k">{{ l }}</button>
        </div>
      </div>
    </template>

    <div>
      <label class="label" for="note">備註</label>
      <textarea id="note" v-model="f.note" class="input h-32 resize-y py-2.5" maxlength="2000" :placeholder="KIND[type].note" />
    </div>
  </main>

  <div class="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[720px] border-t border-line bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
    <button class="btn-primary h-12 w-full" :disabled="!canSave" @click="save">儲存</button>
  </div>
</template>
