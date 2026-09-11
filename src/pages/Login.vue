<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PhAirplaneTilt, PhGoogleLogo } from "@phosphor-icons/vue";
import { store, login, resetDemo } from "../store";
import Avatar from "../components/Avatar.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
const route = useRoute(),
  router = useRouter();
// 插畫放 public/illustration.png（去背 PNG）。還沒放檔案時退回圖示，畫面不會破。
const ART = "/illustration.png";
const art = ref(true);
const demo = ref(false);
function go(id) {
  login(id);
  router.replace(route.query.redirect || "/");
}
</script>

<template>
  <main
    class="relative flex min-h-[100dvh] flex-col overflow-hidden px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
  >
    <!-- 有機色塊：兩片不對稱的 blob，不是方框 -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -right-[22%] -top-[20%] aspect-square w-[135vw] max-w-[620px] bg-hero"
      style="border-radius: 46% 54% 40% 60% / 52% 44% 56% 48%"
    />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -left-[22%] top-[30%] aspect-square w-[52vw] max-w-[210px] bg-hero opacity-25"
      style="border-radius: 62% 38% 55% 45% / 42% 58% 42% 58%"
    />

    <!-- 深淺切換：登入前就能切 -->
    <div
      class="relative z-10 flex justify-end pt-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <ThemeToggle />
    </div>

    <!-- 插畫 -->
    <div
      class="relative flex h-[44dvh] min-h-[240px] shrink-0 items-center justify-center"
    >
      <!-- :src 而非 src，Vite 才不會在檔案還沒放進 public/ 時就編譯失敗 -->
      <img
        v-if="art"
        :src="ART"
        alt=""
        class="max-h-[80%] w-[80%] max-w-[300px] object-contain"
        @error="art = false"
      />
      <PhAirplaneTilt
        v-else
        :size="112"
        weight="duotone"
        class="text-white/85"
      />
    </div>

    <!-- 大標 + 小字級間距標語，對齊參考圖 -->
    <div class="relative mt-2 text-center">
      <h1 class="text-[38px] font-bold leading-none tracking-tight">
        WELCOME!
      </h1>
      <!-- -mr 抵銷 tracking 在最後一個字後面留下的空隙，置中才是真的置中 -->
      <h3 class="mt-3 text-[24px] font-semibold tracking-[0.28em] text-muted">
        行前清單
      </h3>
      <p class="mx-auto mt-4 max-w-60 text-[15px] leading-relaxed text-muted">
        想去的店、想買的東西，貼上連結就存好。旅途中沒網路也看得到。
      </p>
    </div>

    <div class="flex-1" />

    <button
      class="relative h-13 w-full rounded-full bg-accent text-[16px] font-semibold text-accent-fg shadow-e2 transition duration-150 active:scale-[0.97] max-w-115 mx-auto"
      @click="go('u1')"
    >
      <span class="inline-flex items-center gap-2.5">
        <PhGoogleLogo :size="20" weight="bold" />使用 Google 登入
      </span>
    </button>
    <p class="relative mt-3 text-center text-[12px] text-muted">
      只會取得你的 Google 名稱、Email 與頭像。
    </p>

    <!-- 原型用的帳號切換，收起來不佔版面 -->
    <div class="relative mt-6 text-center">
      <button
        class="text-[12px] text-muted underline underline-offset-2"
        @click="demo = !demo"
      >
        {{ demo ? "收起" : "原型：切換示範帳號" }}
      </button>
      <div
        v-if="demo"
        class="mt-3 flex items-center justify-center gap-4 text-[12px] text-muted"
      >
        <button
          v-for="u in store.users"
          :key="u.id"
          class="flex flex-col items-center gap-1 transition active:scale-90"
          @click="go(u.id)"
        >
          <Avatar :user="u" :size="34" /><span>{{ u.name }}</span>
        </button>
        <button class="underline underline-offset-2" @click="resetDemo">
          重設
        </button>
      </div>
    </div>
  </main>
</template>
