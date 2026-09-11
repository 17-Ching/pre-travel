<script setup>
import { useRouter } from 'vue-router'
import { store } from './store'
const router = useRouter()
function act() { router.push(store.toast.action.to); store.toast = null }
</script>

<template>
  <div class="mx-auto min-h-[100dvh] max-w-[720px]">
    <!-- 換頁進場動畫在 style.css 的 `main { animation: page-in }`：純 CSS，
         不經過 <Transition> 的 leave 階段（分頁被切到背景時 rAF 會被節流而卡住）。 -->
    <RouterView />

    <Transition name="toast">
      <div v-if="store.toast" role="status"
        class="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 items-center gap-3 rounded-[14px] bg-ink px-4 py-3 text-[14px] text-surface shadow-e2">
        <span class="flex-1">{{ store.toast.text }}</span>
        <button v-if="store.toast.action" class="shrink-0 font-semibold text-accent" @click="act">{{ store.toast.action.label }}</button>
      </div>
    </Transition>
  </div>
</template>
