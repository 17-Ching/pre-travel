<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PhCamera, PhSignOut, PhArrowCounterClockwise, PhKey, PhCaretDown } from '@phosphor-icons/vue'
import { me, updateProfile, logout, toast } from '../store'
import { changePassword } from '../supabase'
import PasswordInput from '../components/PasswordInput.vue'
import TopBar from '../components/TopBar.vue'

const router = useRouter()
const u = me()
const original = { name: u?.name ?? '', avatar: u?.avatar ?? '' }
// avatarFile 是還沒上傳的原始檔，preview 只是本機預覽用的 blob 網址
const form = ref({ name: original.name, avatar: original.avatar, avatarFile: null })
const busy = ref(false)

const canSave = computed(() => form.value.name.trim()
  && (form.value.name !== original.name || form.value.avatarFile || form.value.avatar !== original.avatar))
const changedAvatar = computed(() => Boolean(form.value.avatarFile) || form.value.avatar !== original.avatar)

function pick(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 20 * 1024 * 1024) return toast('圖片超過 20 MB')
  // 真正的縮圖與上傳在儲存時才做，選了又不存就不該佔用空間
  form.value.avatarFile = file
  form.value.avatar = URL.createObjectURL(file)
}
function resetAvatar() {
  form.value.avatarFile = null
  form.value.avatar = original.avatar
}
async function save() {
  if (busy.value) return
  busy.value = true
  const ok = await updateProfile(form.value)
  busy.value = false
  if (!ok) return
  toast('已更新個人資料')
  router.back()
}
async function out() { await logout(); router.replace('/login') }

// ── 改密碼。跟上面的個人資料是兩件事，所以不共用底下那顆儲存鍵。
// 沒有信箱就沒有忘記密碼流程（見 supabase.js），所以這裡要能看見自己打了什麼，
// 而且新密碼一樣要打兩次。
const pwOpen = ref(false)
const pw = ref({ current: '', next: '', confirm: '' })
const pwError = ref('')
const pwBusy = ref(false)
const pwMismatch = computed(() => pw.value.confirm.length > 0 && pw.value.confirm !== pw.value.next)
const canChangePw = computed(() => pw.value.current && pw.value.next && !pwMismatch.value && !pwBusy.value)
watch(pw, () => { pwError.value = '' }, { deep: true })

async function submitPw() {
  if (!canChangePw.value) return
  pwBusy.value = true
  const { error } = await changePassword(u.username, pw.value.current, pw.value.next)
  pwBusy.value = false
  if (error) { pwError.value = error; return }
  pw.value = { current: '', next: '', confirm: '' }
  pwOpen.value = false
  toast('密碼已更新')
}
</script>

<template>
  <TopBar title="個人資料" back />

  <main class="gutter grid gap-6 pb-32 pt-4">
    <!-- 頭像：整塊可點，就是檔案選擇器 -->
    <div class="flex flex-col items-center">
      <label class="group relative cursor-pointer">
        <img v-if="form.avatar" :src="form.avatar" :alt="form.name" class="size-28 rounded-full bg-line object-cover ring-4 ring-card" />
        <!-- 帳號密碼註冊的人沒有頭像，跟 Avatar 元件用同一套字母備援 -->
        <span v-else class="flex size-28 items-center justify-center rounded-full bg-tint-soft text-[44px] font-semibold text-tint ring-4 ring-card">
          {{ (form.name || '?').trim().charAt(0).toUpperCase() }}
        </span>
        <span class="absolute -bottom-0.5 -right-0.5 flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg shadow-e1 transition duration-150 group-active:scale-90">
          <PhCamera :size="18" weight="bold" />
        </span>
        <input type="file" accept="image/*" class="hidden" :disabled="busy" @change="pick" />
      </label>
      <p v-if="busy" class="mt-3 text-[13px] text-muted">處理中…</p>
      <button v-else-if="changedAvatar" class="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted underline underline-offset-2"
        @click="resetAvatar">
        <PhArrowCounterClockwise :size="14" />還原原本的頭像
      </button>
      <p v-else class="mt-3 text-[13px] text-muted">點頭像換一張</p>
    </div>

    <div>
      <label class="label" for="name">顯示名稱</label>
      <input id="name" v-model="form.name" class="input" maxlength="30" placeholder="其他成員看到的名字" />
      <!-- v2.0 起沒有共同分頁了，這行原本還寫著它 -->
      <p class="mt-1.5 text-[12px] text-muted">會顯示在願望清單的成員列與成員列表。</p>
    </div>

    <!-- 改密碼：預設收起來，平常不佔版面 -->
    <div class="rounded-[14px] border border-line bg-card">
      <button class="flex h-12 w-full items-center gap-3 px-3.5 text-left" :aria-expanded="pwOpen" @click="pwOpen = !pwOpen">
        <PhKey :size="20" class="shrink-0 text-muted" />
        <span class="flex-1 text-[16px]">修改密碼</span>
        <PhCaretDown :size="18" :class="['shrink-0 text-muted transition-transform duration-150', pwOpen && 'rotate-180']" />
      </button>

      <div v-if="pwOpen" class="grid gap-3 border-t border-line p-3.5">
        <div>
          <label class="label" for="pw-current">目前的密碼</label>
          <PasswordInput id="pw-current" v-model="pw.current" autocomplete="current-password" />
        </div>
        <div>
          <label class="label" for="pw-next">新密碼</label>
          <PasswordInput id="pw-next" v-model="pw.next" autocomplete="new-password" placeholder="至少 6 個字" />
        </div>
        <div>
          <label class="label" for="pw-confirm">再輸入一次新密碼</label>
          <PasswordInput id="pw-confirm" v-model="pw.confirm" autocomplete="new-password" placeholder="跟上面一樣" />
          <p v-if="pwMismatch" class="mt-1.5 text-[12px] text-danger">兩次輸入的密碼不一樣</p>
        </div>
        <p v-if="pwError" role="alert" class="text-[13px] font-medium text-danger">{{ pwError }}</p>
        <button class="btn-primary h-11 w-full" :disabled="!canChangePw" @click="submitPw">
          {{ pwBusy ? '更新中…' : '更新密碼' }}
        </button>
        <p class="text-[12px] leading-relaxed text-muted">改完不用重新登入。忘記密碼沒有自助流程，要請專案擁有者到後台重設。</p>
      </div>
    </div>

    <button class="btn-danger mt-2 w-full" @click="out"><PhSignOut :size="18" />登出</button>
  </main>

  <div class="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[720px] border-t border-line bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
    <button class="btn-primary h-12 w-full" :disabled="!canSave || busy" @click="save">儲存</button>
  </div>
</template>
