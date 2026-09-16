<script setup>
// 第一次載入的三種狀態要長得不一樣。以前三種都顯示「還沒有旅程」：
// 剛登入時 token 比伺服器時鐘快一兩秒會被回 401，那一次失敗後 store 是空的，
// 使用者看到的是「你沒有旅程」而不是「載入失敗」，只能自己重整。
import { useRoute, useRouter } from 'vue-router'
import { store, refresh } from '../store'

const route = useRoute(), router = useRouter()

// refresh() 開頭是 `if (!store.me) return`，session 過期時它不動 loading 也不動
// loadError，按下去完全沒反應也沒訊息 —— 比報錯更難懂。停在錯誤畫面夠久就會遇到
// （手機放口袋、隔一陣子再拿出來），所以這裡先擋一層，直接送去重新登入。
function retry() {
  if (!store.me) return router.replace({ path: '/login', query: { redirect: route.fullPath } })
  refresh()
}
</script>

<template>
  <div class="mt-24 text-center">
    <!-- loading 也要算進來：按了重試之後 loadError 立刻被清掉，
         只看 ready / loadError 的話畫面會在重載期間閃回「還沒有旅程」 -->
    <template v-if="!store.ready || store.loading">
      <p class="animate-pulse text-[15px] text-muted">載入中…</p>
    </template>
    <template v-else-if="store.loadError">
      <p class="text-[17px] font-semibold">載入失敗</p>
      <p class="mx-auto mt-1.5 max-w-[320px] text-[14px] leading-relaxed text-muted">{{ store.loadError }}</p>
      <button class="btn-primary mt-6" @click="retry">重試</button>
    </template>
  </div>
</template>
