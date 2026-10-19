<script setup>
import { PhX, PhPlus } from '@phosphor-icons/vue'
import { MAX_LINKS, newLink, sourceLabel } from '../store'
import { useLinkPreview } from '../link-preview'

// 命名連結的編輯欄（F-14）。清單項目、行程項目、每日備註共用。
// links 陣列由呼叫端擁有，這裡直接改它。抓預覽與填連結標題在這裡做；
// 抓到之後還要做什麼（補項目標題、轉存預覽圖）各自不同，所以丟 preview 事件讓呼叫端接。
// 「加入備註」也是丟 desc 事件，備註欄在呼叫端手上。
const props = defineProps({ links: Array, label: String,
  placeholder: { type: String, default: '貼上 Google Maps、IG 或網頁連結' } })
const emit = defineEmits(['preview', 'desc'])
const { previews, load } = useLinkPreview()

async function onUrl(l) {
  const d = await load(l)
  if (d) emit('preview', d)
}
// paste 事件當下 input 的值還是舊的，要等瀏覽器寫進去才讀得到
const onPaste = l => setTimeout(() => onUrl(l))
function add() { if (props.links.length < MAX_LINKS) props.links.push(newLink()) }
</script>

<template>
  <div>
    <span class="label">{{ label ?? `連結（選填，最多 ${MAX_LINKS} 個）` }}</span>
    <div v-if="links.length" class="grid gap-2">
      <div v-for="(l, i) in links" :key="l.id" class="overflow-hidden rounded-xl border border-line bg-card p-2.5">
        <div class="flex items-center gap-2">
          <input v-model="l.title" class="input h-9 min-w-0 flex-1" maxlength="40" placeholder="連結標題（選填）" />
          <button class="icon-btn size-8 shrink-0 text-muted" aria-label="移除這個連結" @click="links.splice(i, 1)"><PhX :size="16" /></button>
        </div>
        <input v-model="l.url" type="url" inputmode="url" class="input mt-2 h-9" :placeholder="placeholder"
          @blur="onUrl(l)" @paste="onPaste(l)" />
        <p v-if="previews[l.id]?.state === 'loading'" class="mt-1.5 px-1 text-[12px] text-muted">正在取得預覽…</p>
        <p v-else-if="previews[l.id]?.state === 'fail'" class="mt-1.5 px-1 text-[12px] text-danger">無法取得預覽，可以手動填標題</p>
        <div v-else-if="l.url.trim()" class="mt-1.5 flex items-baseline gap-2 px-1">
          <span class="shrink-0 text-[12px] text-muted">{{ sourceLabel(l.url) }}</span>
          <button v-if="previews[l.id]?.data?.description" class="truncate text-[12px] font-medium text-accent"
            @click="emit('desc', previews[l.id].data.description)">加入備註</button>
        </div>
      </div>
    </div>
    <button v-if="links.length < MAX_LINKS" class="btn-ghost mt-2 h-9 w-full text-[14px]" @click="add">
      <PhPlus :size="16" weight="bold" />新增連結
    </button>
  </div>
</template>
