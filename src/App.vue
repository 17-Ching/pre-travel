<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretUp } from '@phosphor-icons/vue'
import { store } from './store'
const router = useRouter()

// 回到最上面：往下捲 100px 就出現
const showTop = ref(false)
addEventListener('scroll', () => { showTop.value = scrollY > 100 }, { passive: true })
const toTop = () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
// action 有 to 就換頁，有 run 就直接做（例：刪除後的「復原」）
function act() { const a = store.toast.action; a.run ? a.run() : router.push(a.to); store.toast = null }
</script>

<template>
  <div class="mx-auto min-h-[100dvh] max-w-[720px]">
    <!-- 換頁進場動畫在 style.css 的 `main { animation: page-in }`：純 CSS，
         不經過 <Transition> 的 leave 階段（分頁被切到背景時 rAF 會被節流而卡住）。 -->
    <RouterView />

    <!-- 跟右下角新增鈕同一條右邊線。高度在 style.css 的 .to-top：有新增鈕或底部按鈕列時疊在上面，沒有就貼近底部 -->
    <button aria-label="回到最上面" :tabindex="showTop ? 0 : -1" :aria-hidden="!showTop" @click="toTop"
      :class="['to-top fixed right-[max(1.75rem,calc(50vw-360px+1.75rem))] z-30 flex size-12 items-center justify-center rounded-full border border-line bg-card text-ink shadow-e2 transition duration-200 active:scale-90',
        showTop ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0']">
      <PhCaretUp :size="20" weight="bold" />
    </button>

    <Transition name="toast">
      <div v-if="store.toast" role="status"
        class="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 items-center gap-3 rounded-[14px] bg-ink px-4 py-3 text-[14px] text-surface shadow-e2">
        <span class="flex-1">{{ store.toast.text }}</span>
        <button v-if="store.toast.action" class="shrink-0 font-semibold text-accent" @click="act">{{ store.toast.action.label }}</button>
      </div>
    </Transition>
  </div>
</template>
