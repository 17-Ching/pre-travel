<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhX, PhCaretRight, PhImage } from '@phosphor-icons/vue'
import { store, trip, isOwner, createTrip, updateTrip, deleteTrip, COUNTRIES, flag, countryName, shrinkImage, MAX, toast } from '../store'
import TopBar from '../components/TopBar.vue'

const route = useRoute(), router = useRouter()
const editing = !!route.params.tripId
const t = editing ? trip(route.params.tripId) : null
if (editing && !isOwner(route.params.tripId)) router.replace(`/trips/${route.params.tripId}`)

const form = ref({ name: t?.name ?? '', country: t?.country ?? '', start: t?.start ?? '', end: t?.end ?? '', cover: t?.cover ?? null })
const q = ref('')
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? COUNTRIES.filter(c => c.name.includes(s) || c.code.toLowerCase().includes(s)).slice(0, 6) : []
})
const canSave = computed(() => form.value.name.trim() && form.value.country)
const itemCount = computed(() => store.items.filter(i => i.tripId === t?.id).length)

async function pickCover(e) {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f) return
  if (f.size > 20 * 1024 * 1024) return toast('圖片超過 20 MB')
  try { form.value.cover = (await shrinkImage(f, MAX.cover)).url } catch { toast('這張圖讀不到，換一張試試') }
}
function save() {
  if (editing) { updateTrip(t.id, form.value); router.back() }
  else router.replace(`/trips/${createTrip(form.value)}`)
}
function remove() {
  if (confirm(`確定刪除「${t.name}」？\n裡面的 ${itemCount.value} 個項目會一起刪除，無法復原。`)) { deleteTrip(t.id); router.replace('/') }
}
const links = [['members', '成員與邀請'], ['regions', '地區'], ['tags', '標籤']]
</script>

<template>
  <TopBar :title="editing ? '編輯專案' : '新旅程'" back />
  <main class="grid gap-5 px-4 pb-32 pt-2">
    <div>
      <label class="label" for="name">名稱</label>
      <input id="name" v-model="form.name" class="input" maxlength="50" placeholder="例：2026 秋・日本" />
    </div>

    <div>
      <label class="label" for="country">國家</label>
      <div v-if="form.country" class="input flex items-center gap-2">
        <span class="text-[20px]">{{ flag(form.country) }}</span>
        <span class="flex-1">{{ countryName(form.country) }}</span>
        <button class="icon-btn -mr-2 size-8" aria-label="清除國家" @click="form.country = ''"><PhX :size="16" /></button>
      </div>
      <template v-else>
        <input id="country" v-model="q" class="input" placeholder="輸入國家名稱搜尋" autocomplete="off" />
        <ul v-if="matches.length" class="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          <li v-for="c in matches" :key="c.code">
            <button class="flex h-11 w-full items-center gap-3 px-3.5 text-left active:bg-ink/5" @click="form.country = c.code; q = ''">
              <span class="text-[20px]">{{ flag(c.code) }}</span>{{ c.name }}
            </button>
          </li>
        </ul>
      </template>
    </div>

    <!-- 上下排：手機的 date 輸入框並排一定會擠（內在最小寬度很大） -->
    <div class="grid gap-3">
      <div><label class="label" for="start">出發日</label><input id="start" v-model="form.start" type="date" class="input" /></div>
      <div><label class="label" for="end">回程日</label><input id="end" v-model="form.end" type="date" :min="form.start" class="input" /></div>
    </div>

    <div>
      <span class="label">封面圖（選填）</span>
      <div v-if="form.cover" class="relative overflow-hidden rounded-xl">
        <img :src="form.cover" alt="" class="aspect-[16/9] w-full bg-line object-cover" />
        <button class="icon-btn absolute right-2 top-2 size-8 bg-card/90" aria-label="移除封面" @click="form.cover = null"><PhX :size="16" /></button>
      </div>
      <label v-else class="flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-card text-muted">
        <PhImage :size="28" /><span class="text-[13px]">選擇圖片</span>
        <input type="file" accept="image/*" class="hidden" @change="pickCover" />
      </label>
    </div>

    <template v-if="editing">
      <nav class="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        <RouterLink v-for="[path, label] in links" :key="path" :to="`/trips/${t.id}/${path}`" class="flex h-12 items-center px-4 active:bg-ink/5">
          <span class="flex-1">{{ label }}</span><PhCaretRight :size="16" class="text-muted" />
        </RouterLink>
      </nav>
      <button class="btn-danger" @click="remove">刪除專案</button>
    </template>
  </main>

  <div class="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[720px] border-t border-line bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
    <button class="btn-primary h-12 w-full" :disabled="!canSave" @click="save">{{ editing ? '儲存' : '建立旅程' }}</button>
  </div>
</template>
