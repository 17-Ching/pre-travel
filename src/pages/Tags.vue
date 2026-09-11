<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { PhPencilSimple, PhTrash } from '@phosphor-icons/vue'
import { myTags, ensureTag, renameTag, deleteTag, tagUsage } from '../store'
import TopBar from '../components/TopBar.vue'
import TagChip from '../components/TagChip.vue'

const tripId = useRoute().params.tripId
const tags = computed(() => myTags(tripId))
const name = ref('')
function add() { if (ensureTag(tripId, name.value)) name.value = '' }
function rename(g) { const n = prompt('標籤名稱', g.name); if (n) renameTag(g, n) }
function remove(g) {
  const n = tagUsage(g)
  if (confirm(`刪除「${g.name}」？${n ? `\n${n} 個項目將移除此標籤。` : ''}`)) deleteTag(g)
}
</script>

<template>
  <TopBar title="我的標籤" back />
  <main class="px-4 pb-12 pt-2">
    <form class="flex gap-2" @submit.prevent="add">
      <input v-model="name" class="input" maxlength="20" placeholder="新標籤，例：拉麵" />
      <button class="btn-primary shrink-0" :disabled="!name.trim()">新增</button>
    </form>
    <p class="mt-2 text-[12px] text-muted">標籤只有你看得到，只在這個專案內使用。{{ tags.length }} / 50</p>

    <p v-if="!tags.length" class="mt-12 text-center text-muted">還沒有標籤。在新增項目時輸入也會自動建立。</p>
    <ul v-else class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
      <li v-for="g in tags" :key="g.id" class="flex h-[52px] items-center gap-2 pl-4 pr-2">
        <TagChip :name="g.name" />
        <span class="flex-1 text-[13px] text-muted">{{ tagUsage(g) }} 個項目</span>
        <button class="icon-btn size-9" aria-label="改名" @click="rename(g)"><PhPencilSimple :size="18" /></button>
        <button class="icon-btn size-9 text-danger" aria-label="刪除" @click="remove(g)"><PhTrash :size="18" /></button>
      </li>
    </ul>
  </main>
</template>
