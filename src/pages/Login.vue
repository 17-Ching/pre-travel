<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhAirplaneTilt, PhEye, PhEyeSlash } from '@phosphor-icons/vue'
import { signIn, signUp } from '../store'
import { validateCredentials } from '../auth-rules'
import ThemeToggle from '../components/ThemeToggle.vue'

const route = useRoute(), router = useRouter()
// 插畫放 public/illustration.png（去背 PNG）。還沒放檔案時退回圖示，畫面不會破。
const ART = '/illustration.png'
const art = ref(true)

const mode = ref('signin') // signin | signup
const username = ref('')
const password = ref('')
const displayName = ref('')
const showPw = ref(false)
const error = ref('')
const busy = ref(false)
const isSignup = computed(() => mode.value === 'signup')

function toggleMode() {
  mode.value = isSignup.value ? 'signin' : 'signup'
  error.value = ''
}

// 送出鍵要 disable：這是網路請求，連點會送出好幾次註冊
async function submit() {
  if (busy.value) return
  error.value = validateCredentials(username.value, password.value)
  if (error.value) return
  busy.value = true
  try {
    const { error: err } = isSignup.value
      ? await signUp(username.value, password.value, displayName.value)
      : await signIn(username.value, password.value)
    if (err) { error.value = err; return }
    router.replace(route.query.redirect || '/')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="relative flex min-h-[100dvh] flex-col overflow-hidden px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
    <!-- 有機色塊：兩片不對稱的 blob，不是方框 -->
    <div aria-hidden="true" class="pointer-events-none absolute -right-[22%] -top-[20%] aspect-square w-[135vw] max-w-[620px] bg-hero"
      style="border-radius: 46% 54% 40% 60% / 52% 44% 56% 48%" />
    <div aria-hidden="true" class="pointer-events-none absolute -left-[22%] top-[30%] aspect-square w-[52vw] max-w-[210px] bg-hero opacity-25"
      style="border-radius: 62% 38% 55% 45% / 42% 58% 42% 58%" />

    <!-- 深淺切換：登入前就能切 -->
    <div class="relative z-10 flex justify-end pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <ThemeToggle />
    </div>

    <!-- 插畫。表單佔掉版面，所以比原本矮 -->
    <div class="relative flex h-[28dvh] min-h-[150px] shrink-0 items-center justify-center">
      <!-- :src 而非 src，Vite 才不會在檔案還沒放進 public/ 時就編譯失敗 -->
      <img v-if="art" :src="ART" alt="" class="max-h-[88%] w-[70%] max-w-[240px] object-contain" @error="art = false" />
      <PhAirplaneTilt v-else :size="88" weight="duotone" class="text-white/85" />
    </div>

    <div class="relative mt-1 text-center">
      <h1 class="text-[34px] font-bold leading-none tracking-tight">WELCOME!</h1>
      <!-- -mr 抵銷 tracking 在最後一個字後面留下的空隙，置中才是真的置中 -->
      <h3 class="mt-2.5 -mr-[0.28em] text-[18px] font-semibold tracking-[0.28em] text-muted">行前清單</h3>
    </div>

    <div class="flex-1" />

    <form class="relative mx-auto grid w-full max-w-[420px] gap-3" @submit.prevent="submit">
      <div>
        <label class="label" for="username">帳號</label>
        <input id="username" v-model="username" class="input" maxlength="20" autocapitalize="none" autocorrect="off"
          spellcheck="false" autocomplete="username" placeholder="英數字和底線，3–20 字" />
      </div>

      <div>
        <label class="label" for="password">密碼</label>
        <div class="relative">
          <input id="password" v-model="password" :type="showPw ? 'text' : 'password'" class="input pr-12"
            :autocomplete="isSignup ? 'new-password' : 'current-password'" :placeholder="`至少 6 個字`" />
          <!-- 沒有信箱就沒有忘記密碼流程，打錯一個字就進不來，所以一定要能看見自己打了什麼 -->
          <button type="button" class="icon-btn absolute right-1 top-1/2 size-9 -translate-y-1/2 text-muted"
            :aria-label="showPw ? '隱藏密碼' : '顯示密碼'" @click="showPw = !showPw">
            <component :is="showPw ? PhEyeSlash : PhEye" :size="18" />
          </button>
        </div>
      </div>

      <div v-if="isSignup">
        <label class="label" for="displayName">顯示名稱（選填）</label>
        <input id="displayName" v-model="displayName" class="input" maxlength="30" autocomplete="nickname"
          placeholder="留空就用帳號當顯示名稱" />
      </div>

      <p v-if="error" role="alert" class="text-[13px] font-medium text-danger">{{ error }}</p>

      <button type="submit" :disabled="busy"
        class="mt-1 h-13 w-full rounded-full bg-accent text-[16px] font-semibold text-accent-fg shadow-e2 transition duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60">
        {{ busy ? '請稍候…' : isSignup ? '建立帳號' : '登入' }}
      </button>
    </form>

    <p class="relative mt-4 text-center text-[13px] text-muted">
      {{ isSignup ? '已經有帳號了？' : '還沒有帳號？' }}
      <button class="font-semibold text-accent underline underline-offset-2" @click="toggleMode">
        {{ isSignup ? '登入' : '註冊' }}
      </button>
    </p>

    <!-- 沒有信箱就沒有自助的忘記密碼，先講清楚，免得有人事後才發現 -->
    <p v-if="isSignup" class="relative mt-3 text-center text-[12px] leading-relaxed text-muted">
      不需要 Email。密碼請自己記好，忘記的話要請專案擁有者協助重設。
    </p>
  </main>
</template>
