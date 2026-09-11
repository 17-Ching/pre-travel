<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { PhArrowUp, PhArrowDown, PhPencilSimple, PhTrash } from '@phosphor-icons/vue'
import { regionsOf, addRegion, renameRegion, moveRegion, deleteRegion, regionItemCount } from '../store'
import TopBar from '../components/TopBar.vue'

const tripId = useRoute().params.tripId
const regions = computed(() => regionsOf(tripId))
const name = ref('')
function add() { if (addRegion(tripId, name.value)) name.value = '' }
function rename(r) { const n = prompt('地區名稱', r.name); if (n) renameRegion(r, n) }
function remove(r) {
  const n = regionItemCount(r)
  if (confirm(`刪除「${r.name}」？${n ? `\n${n} 個項目將變為未分類。` : ''}`)) deleteRegion(r)
}
</script>

<template>
  <TopBar title="地區" back />
  <main class="px-4 pb-12 pt-2">
    <form class="flex gap-2" @submit.prevent="add">
      <input v-model="name" class="input" maxlength="30" placeholder="新地區，例：東京" />
      <button class="btn-primary shrink-0" :disabled="!name.trim()">新增</button>
    </form>

    <p v-if="!regions.length" class="mt-12 text-center text-muted">還沒有地區。先加一個，地點與購物就能依地區整理。</p>
    <!-- ponytail: up/down buttons instead of drag sort; swap for a drag lib when someone asks -->
    <ul v-else class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
      <li v-for="(r, i) in regions" :key="r.id" class="flex h-[52px] items-center gap-1 pl-4 pr-2">
        <span class="flex-1 truncate">{{ r.name }}<span class="ml-2 text-[13px] text-muted">{{ regionItemCount(r) }}</span></span>
        <button class="icon-btn size-9" aria-label="上移" :disabled="i === 0" @click="moveRegion(r, -1)"><PhArrowUp :size="18" /></button>
        <button class="icon-btn size-9" aria-label="下移" :disabled="i === regions.length - 1" @click="moveRegion(r, 1)"><PhArrowDown :size="18" /></button>
        <button class="icon-btn size-9" aria-label="改名" @click="rename(r)"><PhPencilSimple :size="18" /></button>
        <button class="icon-btn size-9 text-danger" aria-label="刪除" @click="remove(r)"><PhTrash :size="18" /></button>
      </li>
    </ul>
  </main>
</template>
