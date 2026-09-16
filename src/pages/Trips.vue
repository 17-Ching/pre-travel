<script setup>
import { computed } from "vue";
import { PhPlus } from "@phosphor-icons/vue";
import {
  store,
  myTrips,
  tripMembers,
  user,
  me,
  flag,
  countryName,
  fmtDate,
  tagHue,
} from "../store";
import TopBar from "../components/TopBar.vue";
import Avatar from "../components/Avatar.vue";
import LoadState from "../components/LoadState.vue";
import ThemeToggle from "../components/ThemeToggle.vue";

const trips = computed(myTrips);
const activeMembers = (id) =>
  tripMembers(id)
    .filter((m) => m.status === "active")
    .map((m) => user(m.userId));
// 資料夾上緣的顏色依名稱雜湊，跟標籤共用同一組色相，重開也不會變
const tabHue = (name) => `tag-${tagHue(name)}`;
const counts = (id) => {
  const list = store.items.filter((i) => i.tripId === id);
  return {
    place: list.filter((i) => i.type === "place").length,
    shop: list.filter((i) => i.type === "shopping").length,
  };
};
</script>

<template>
  <TopBar title="我的旅程">
    <ThemeToggle />
    <RouterLink to="/profile" class="icon-btn" aria-label="個人資料"
      ><Avatar :user="me()" :size="28"
    /></RouterLink>
  </TopBar>

  <main class="gutter pb-28 pt-8">
    <!-- 載入中與載入失敗要跟「真的沒有旅程」分開，三種以前長得一模一樣 -->
    <LoadState v-if="!store.ready || store.loading || store.loadError" />

    <div v-else-if="!trips.length" class="mt-24 text-center">
      <p class="text-[17px] font-semibold">還沒有旅程</p>
      <p class="mt-1.5 text-[14px] text-muted">
        建立第一個旅程，開始收藏想去的店。
      </p>
      <RouterLink to="/trips/new" class="btn-primary mt-6"
        >建立第一個旅程</RouterLink
      >
    </div>

    <!-- 資料夾格狀：上緣色塊 + 卡身，雙欄 -->
    <ul v-else class="grid grid-cols-2 gap-x-3 gap-y-4 pt-3 sm:grid-cols-3">
      <li v-for="t in trips" :key="t.id" class="relative pt-3">
        <span
          aria-hidden="true"
          :class="[
            'folder-tab absolute left-3 top-0 h-3.5 w-16 rounded-t-[8px]',
            tabHue(t.name),
          ]"
        />
        <RouterLink
          :to="`/trips/${t.id}`"
          class="card relative block overflow-hidden shadow-e1 transition duration-150 active:scale-[0.98]"
        >
          <div class="relative">
            <img
              v-if="t.cover"
              :src="t.cover"
              :alt="t.name"
              class="aspect-[16/10] w-full bg-line object-cover"
            />
            <div
              v-else
              class="flex aspect-[16/10] w-full items-center justify-center bg-tint-soft text-[40px] leading-none"
            >
              {{ flag(t.country) }}
            </div>
            <span
              class="absolute left-1.5 top-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
            >
              {{ flag(t.country) }} {{ countryName(t.country) }}
            </span>
          </div>

          <div class="p-2.5">
            <p class="text-[11px] tabular-nums text-muted">
              {{ counts(t.id).place }} 地點・{{ counts(t.id).shop }} 購物
            </p>
            <h2
              class="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug tracking-tight"
            >
              {{ t.name }}
            </h2>
            <div class="mt-2 flex items-end justify-between gap-1">
              <span
                class="min-w-0 truncate text-[11px] tabular-nums text-muted"
              >
                <template v-if="t.start"
                  >{{ fmtDate(t.start)
                  }}<template v-if="t.end"
                    >–{{ fmtDate(t.end) }}</template
                  ></template
                >
              </span>
              <div class="flex shrink-0 -space-x-1.5">
                <Avatar
                  v-for="u in activeMembers(t.id).slice(0, 3)"
                  :key="u.id"
                  :user="u"
                  :size="20"
                  class="ring-2 ring-card"
                />
                <span
                  v-if="activeMembers(t.id).length > 3"
                  class="flex size-5 items-center justify-center rounded-full bg-line text-[9px] font-medium ring-2 ring-card"
                  >+{{ activeMembers(t.id).length - 3 }}</span
                >
              </div>
            </div>
          </div>
        </RouterLink>
      </li>
    </ul>
  </main>

  <RouterLink
    v-if="store.ready && !store.loading && !store.loadError"
    to="/trips/new"
    class="btn-primary fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[max(1.5rem,calc(50vw-360px+1.5rem))] z-30 h-[52px] rounded-full px-5 shadow-e2"
  >
    <PhPlus :size="20" weight="bold" />新旅程
  </RouterLink>
</template>
