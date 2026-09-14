<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhX, PhLink, PhImage, PhPlus } from '@phosphor-icons/vue'
import { store, item as getItem, regionsOf, myTags, ensureTag, addRegion, saveItem, fetchPreview, tagColor, toast,
  uploadItemImage, uploadImageFromDataUrl, MAX_LINKS, newLink, sourceLabel } from '../store'
import TopBar from '../components/TopBar.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const existing = route.params.itemId ? getItem(route.params.itemId) : null
const type = existing?.type ?? (route.query.type === 'shopping' ? 'shopping' : 'place')
const qRegion = route.query.region
const f = ref(existing ? JSON.parse(JSON.stringify(existing)) : {
  tripId, type, ownerUserId: route.query.tab === 'shared' ? null : store.me,
  title: '', links: [newLink()], regionId: qRegion && qRegion !== 'all' && qRegion !== 'none' ? qRegion : null,
  images: [], note: '', visited: false, status: 'todo', plannedStore: '', tagIds: [],
})

const regions = computed(() => regionsOf(tripId))
const tags = computed(() => myTags(tripId))
const tagInput = ref('')
const tagExists = computed(() => tags.value.some(g => g.name === tagInput.value.trim()))
function addTag() { const g = ensureTag(tripId, tagInput.value); if (g && !f.value.tagIds.includes(g.id)) f.value.tagIds.push(g.id); tagInput.value = '' }
function toggleTag(id) { const i = f.value.tagIds.indexOf(id); i < 0 ? f.value.tagIds.push(id) : f.value.tagIds.splice(i, 1) }
function onRegion(e) {
  if (e.target.value !== '__new') return (f.value.regionId = e.target.value || null)
  const r = addRegion(tripId, prompt('新地區名稱') || '')
  f.value.regionId = r?.id ?? null
  e.target.value = f.value.regionId ?? ''
}

// F-14 連結預覽。每個連結各自抓，只填「還空著」的欄位，所以不需要覆蓋確認。
const previews = ref({}) // linkId -> { state, url, data }
function addLink() { if (f.value.links.length < MAX_LINKS) f.value.links.push(newLink()) }
function removeLink(i) { delete previews.value[f.value.links[i].id]; f.value.links.splice(i, 1) }
async function onUrl(l) {
  const url = l.url.trim()
  if (!url || url === previews.value[l.id]?.url) return
  previews.value[l.id] = { state: 'loading', url }
  try {
    const d = await fetchPreview(url)
    previews.value[l.id] = { state: 'ok', url, data: d }
    if (!l.title.trim()) l.title = d.title
    if (!f.value.title.trim()) f.value.title = d.title
    // 預覽圖轉存成自己的副本再放進圖片列，來源網址過期也不會變破圖（F-14）
    if (d.image && !f.value.images.length) {
      try { f.value.images.push(await uploadImageFromDataUrl(tripId, d.image)) } catch { /* 有標題就夠用了 */ }
    }
  } catch { previews.value[l.id] = { state: 'fail', url } }
}
const onPaste = l => setTimeout(() => onUrl(l))
function addDesc(l) {
  const d = previews.value[l.id]?.data?.description
  if (d) f.value.note = (f.value.note ? f.value.note + '\n' : '') + d
}

// F-27 圖片：前端壓縮後直接上傳 bucket，資料庫只存路徑
const busy = ref(false)
async function addFiles(e) {
  const files = [...e.target.files]
  e.target.value = ''
  busy.value = true
  for (const file of files) {
    if (f.value.images.length >= 5) { toast('每個項目最多 5 張圖片'); break }
    if (file.size > 20 * 1024 * 1024) { toast(`${file.name} 超過 20 MB`); continue }
    try { f.value.images.push(await uploadItemImage(tripId, file)) } catch (err) { toast(err.message || `${file.name} 讀不到`) }
  }
  busy.value = false
}
// F-28 貼圖片網址：由後端下載再轉存，因為瀏覽器抓跨網域圖片會污染 canvas
async function addImageUrl() {
  const url = prompt('貼上圖片網址')
  if (!url) return
  if (f.value.images.length >= 5) return toast('每個項目最多 5 張圖片')
  busy.value = true
  try {
    const d = await fetchPreview(url)
    if (!d.image) throw new Error('這個網址沒有圖片')
    f.value.images.push(await uploadImageFromDataUrl(tripId, d.image))
  } catch (err) { toast(err.message === 'blocked' ? '這個網址不允許存取' : '無法取得圖片') }
  busy.value = false
}

const canSave = computed(() => f.value.title.trim())
function save() {
  f.value.links = f.value.links.filter(l => l.url.trim()) // 空白列不存
  saveItem(f.value)
  existing ? router.back() : router.replace(`/trips/${tripId}`)
}
const STATUS = [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']]
</script>

<template>
  <TopBar :title="(existing ? '編輯' : '新增') + (type === 'place' ? '地點' : '購物')" back />
  <main class="grid gap-5 px-4 pb-32 pt-2">
    <div>
      <label class="label" for="title">標題</label>
      <input id="title" v-model="f.title" class="input" maxlength="100" :placeholder="type === 'place' ? '店名或景點名稱' : '想買的東西'" />
    </div>

    <div>
      <span class="label">連結（最多 {{ MAX_LINKS }} 個）</span>
      <div class="grid gap-2">
        <div v-for="(l, i) in f.links" :key="l.id" class="overflow-hidden rounded-xl border border-line bg-card p-2.5">
          <div class="flex items-center gap-2">
            <input v-model="l.title" class="input h-9 min-w-0 flex-1" maxlength="40" placeholder="連結標題（選填）" />
            <button class="icon-btn size-8 shrink-0 text-muted" aria-label="移除這個連結" @click="removeLink(i)"><PhX :size="16" /></button>
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
      <button v-if="f.links.length < MAX_LINKS" class="btn-ghost mt-2 h-9 w-full text-[14px]" @click="addLink">
        <PhPlus :size="16" weight="bold" />新增連結
      </button>

    </div>

    <div>
      <span class="label">圖片（最多 5 張）</span>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="(im, i) in f.images" :key="im.url" class="relative">
          <img :src="im.url" alt="" class="aspect-square w-full rounded-lg bg-line object-cover" />
          <button class="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-surface" aria-label="移除圖片" @click="f.images.splice(i, 1)"><PhX :size="12" weight="bold" /></button>
        </div>
        <label v-if="f.images.length < 5" :class="['flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-card text-muted', busy && 'pointer-events-none opacity-50']">
          <PhImage :size="22" /><span class="text-[11px]">{{ busy ? '處理中…' : '相簿 / 拍照' }}</span>
          <input type="file" accept="image/*" multiple class="hidden" :disabled="busy" @change="addFiles" />
        </label>
        <button v-if="f.images.length < 5" class="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-card text-muted" @click="addImageUrl">
          <PhLink :size="22" /><span class="text-[11px]">貼圖片網址</span>
        </button>
      </div>
    </div>

    <div>
      <label class="label" for="region">地區</label>
      <select id="region" class="input" :value="f.regionId ?? ''" @change="onRegion">
        <option value="">未分類</option>
        <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
        <option value="__new">＋ 新增地區…</option>
      </select>
    </div>

    <div>
      <label class="label" for="tag">標籤</label>
      <div v-if="tags.length" class="mb-2 flex flex-wrap gap-1.5">
        <button v-for="g in tags" :key="g.id" @click="toggleTag(g.id)"
          :class="['h-7 rounded-full border px-2.5 text-[13px] font-medium transition', f.tagIds.includes(g.id) ? tagColor(g.name) + ' border-transparent' : 'border-line bg-card text-muted']">{{ g.name }}</button>
      </div>
      <input id="tag" v-model="tagInput" class="input" maxlength="20" placeholder="輸入新標籤，按 Enter 建立" @keydown.enter.prevent="tagInput.trim() && addTag()" />
      <button v-if="tagInput.trim() && !tagExists" class="mt-2 text-[13px] font-medium text-accent" @click="addTag">建立「{{ tagInput.trim() }}」</button>
    </div>

    <template v-if="type === 'shopping'">
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
      <textarea id="note" v-model="f.note" class="input h-32 resize-y py-2.5" maxlength="2000" placeholder="營業時間、要點什麼、注意事項…" />
    </div>
  </main>

  <div class="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[720px] border-t border-line bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
    <button class="btn-primary h-12 w-full" :disabled="!canSave" @click="save">儲存</button>
  </div>
</template>
