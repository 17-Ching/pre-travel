<script setup>
import { reactive } from 'vue'
import { useRoute } from 'vue-router'
import { PhPencilSimple, PhTrash } from '@phosphor-icons/vue'
import { myTags, ensureTag, renameTag, deleteTag, tagUsage } from '../store'
import TopBar from '../components/TopBar.vue'
import TagChip from '../components/TagChip.vue'

const tripId = useRoute().params.tripId
// 兩池標籤各自一區：地點與購物共用一池，參考自己一池（同名也各自獨立）。
// 各自有新增框，免得在這頁建的標籤不知道會進哪一池。
const POOLS = [
  { scope: 'default', title: '地點與購物', hint: '新標籤，例：拉麵' },
  { scope: 'reference', title: '參考', hint: '新分類，例：轉場影片' },
]
const names = reactive({ default: '', reference: '' })
function add(scope) { if (ensureTag(tripId, names[scope], scope)) names[scope] = '' }
function rename(g) { const n = prompt('標籤名稱', g.name); if (n) renameTag(g, n) }
function remove(g) {
  const n = tagUsage(g)
  if (confirm(`刪除「${g.name}」？${n ? `\n${n} 個項目將移除此標籤。` : ''}`)) deleteTag(g)
}
</script>

<template>
  <TopBar title="我的標籤" back />
  <main class="px-4 pb-12 pt-2">
    <p class="text-[12px] leading-relaxed text-muted">同行的人看得到你的標籤、也能用它篩選你的清單，但只有你能新增與修改。只在這個專案內使用。</p>

    <section v-for="pool in POOLS" :key="pool.scope" class="mt-6">
      <h2 class="mb-2 flex items-baseline gap-2 text-[15px] font-semibold">
        {{ pool.title }}
        <span class="text-[12px] font-normal tabular-nums text-muted">{{ myTags(tripId, pool.scope).length }} / 50</span>
      </h2>
      <form class="flex gap-2" @submit.prevent="add(pool.scope)">
        <input v-model="names[pool.scope]" class="input" maxlength="20" :placeholder="pool.hint" />
        <button class="btn-primary shrink-0" :disabled="!names[pool.scope].trim()">新增</button>
      </form>

      <p v-if="!myTags(tripId, pool.scope).length" class="mt-4 text-center text-[13px] text-muted">還沒有標籤。在新增項目時輸入也會自動建立。</p>
      <ul v-else class="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        <li v-for="g in myTags(tripId, pool.scope)" :key="g.id" class="flex h-[52px] items-center gap-2 pl-4 pr-2">
          <TagChip :name="g.name" />
          <span class="flex-1 text-[13px] text-muted">{{ tagUsage(g) }} 個項目</span>
          <button class="icon-btn size-9" aria-label="改名" @click="rename(g)"><PhPencilSimple :size="18" /></button>
          <button class="icon-btn size-9 text-danger" aria-label="刪除" @click="remove(g)"><PhTrash :size="18" /></button>
        </li>
      </ul>
    </section>
  </main>
</template>
