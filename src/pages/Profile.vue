<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhCamera, PhSignOut, PhArrowCounterClockwise } from '@phosphor-icons/vue'
import { me, updateProfile, shrinkImage, MAX, logout, toast } from '../store'
import TopBar from '../components/TopBar.vue'

const router = useRouter()
const u = me()
const original = { name: u.name, avatar: u.avatar }
const form = ref({ name: u.name, avatar: u.avatar })
const busy = ref(false)

const canSave = computed(() => form.value.name.trim() && (form.value.name !== original.name || form.value.avatar !== original.avatar))
const changedAvatar = computed(() => form.value.avatar !== original.avatar)

async function pick(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 20 * 1024 * 1024) return toast('圖片超過 20 MB')
  busy.value = true
  try { form.value.avatar = (await shrinkImage(file, MAX.avatar)).url } catch { toast('這張圖讀不到，換一張試試') }
  busy.value = false
}
function save() {
  if (!updateProfile(form.value)) return toast('名稱不能空白')
  toast('已更新個人資料')
  router.back()
}
function out() { logout(); router.replace('/login') }
</script>

<template>
  <TopBar title="個人資料" back />

  <main class="gutter grid gap-6 pb-32 pt-4">
    <!-- 頭像：整塊可點，就是檔案選擇器 -->
    <div class="flex flex-col items-center">
      <label class="group relative cursor-pointer">
        <img :src="form.avatar" :alt="form.name" class="size-28 rounded-full bg-line object-cover ring-4 ring-card" />
        <span class="absolute -bottom-0.5 -right-0.5 flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg shadow-e1 transition duration-150 group-active:scale-90">
          <PhCamera :size="18" weight="bold" />
        </span>
        <input type="file" accept="image/*" class="hidden" :disabled="busy" @change="pick" />
      </label>
      <p v-if="busy" class="mt-3 text-[13px] text-muted">處理中…</p>
      <button v-else-if="changedAvatar" class="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted underline underline-offset-2"
        @click="form.avatar = original.avatar">
        <PhArrowCounterClockwise :size="14" />還原原本的頭像
      </button>
      <p v-else class="mt-3 text-[13px] text-muted">點頭像換一張</p>
    </div>

    <div>
      <label class="label" for="name">顯示名稱</label>
      <input id="name" v-model="form.name" class="input" maxlength="30" placeholder="其他成員看到的名字" />
      <p class="mt-1.5 text-[12px] text-muted">會顯示在分頁列、共同分頁的「由誰新增」與成員列表。</p>
    </div>

    <button class="btn-danger mt-2 w-full" @click="out"><PhSignOut :size="18" />登出</button>
  </main>

  <div class="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[720px] border-t border-line bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
    <button class="btn-primary h-12 w-full" :disabled="!canSave || busy" @click="save">儲存</button>
  </div>
</template>
