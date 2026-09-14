<script setup>
import { computed, ref } from 'vue'
import { PhMapPin, PhShoppingBag, PhCheck, PhDotsThreeVertical } from '@phosphor-icons/vue'
import { store, user, sourceLabel, firstUrl } from '../store'
import TagChip from './TagChip.vue'
import Avatar from './Avatar.vue'

const props = defineProps({ item: Object, editable: Boolean, showAuthor: Boolean })
const emit = defineEmits(['status', 'visited', 'menu'])

// 連結預覽圖在儲存時就被轉存成第一張圖片了，這裡不用再管外部網址
const thumb = computed(() => props.item.images[0]?.url || '')
const region = computed(() => store.regions.find(r => r.id === props.item.regionId)?.name)
const tags = computed(() => props.item.tagIds.map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean))
const done = computed(() => (props.item.type === 'shopping' ? props.item.status === 'bought' : props.item.visited))
// 縮圖上的來源標示看第一個連結；還有其他連結就加上數量
const links = computed(() => props.item.links ?? [])
const source = computed(() => {
  const s = sourceLabel(firstUrl(props.item))
  return s && links.value.length > 1 ? `${s} +${links.value.length - 1}` : s
})
const STATUS = { todo: '未買', bought: '已買', not_found: '沒買到' }

// 勾選的觸覺回饋：只是 240ms 的 scale，不擋寫入（F-19 樂觀更新）。
const popping = ref(false)
function fire(evt) {
  popping.value = false
  requestAnimationFrame(() => (popping.value = true))
  emit(evt)
}
</script>

<template>
  <article :class="['card flex gap-3 p-3 transition duration-200', done ? 'opacity-55' : 'shadow-e1']">
    <RouterLink :to="`/trips/${item.tripId}/items/${item.id}`" class="flex min-w-0 flex-1 gap-3">
      <div class="relative size-[88px] shrink-0">
        <img v-if="thumb" :src="thumb" alt="" loading="lazy" class="size-full rounded-[10px] bg-line object-cover" />
        <div v-else class="flex size-full items-center justify-center rounded-[10px] bg-tint-soft text-tint">
          <component :is="item.type === 'place' ? PhMapPin : PhShoppingBag" :size="28" />
        </div>
        <!-- 來源一眼看得出來：從 Maps 還是 IG 存的 -->
        <span v-if="source" class="absolute bottom-1 left-1 max-w-[80px] truncate rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">{{ source }}</span>
      </div>

      <div class="min-w-0 flex-1">
        <h3 :class="['line-clamp-2 text-[16px] font-semibold leading-[1.35] tracking-tight', item.status === 'bought' && 'line-through decoration-1']">{{ item.title }}</h3>
        <p v-if="item.plannedStore" class="mt-1 truncate text-[13px] font-medium text-accent">{{ item.plannedStore }}</p>
        <div v-if="region || tags.length" class="mt-2 flex flex-wrap gap-1.5">
          <span v-if="region" class="inline-flex h-[22px] items-center rounded-md bg-tint-soft px-1.5 text-[11px] font-medium text-tint">{{ region }}</span>
          <TagChip v-for="n in tags" :key="n" :name="n" />
        </div>
        <p v-if="item.note" class="mt-2 line-clamp-2 whitespace-pre-line text-[13px] leading-relaxed text-muted">{{ item.note }}</p>
        <div v-if="showAuthor" class="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <Avatar :user="user(item.createdBy)" :size="16" />{{ user(item.createdBy)?.name }} 新增
        </div>
      </div>
    </RouterLink>

    <div class="flex flex-col items-end gap-1.5">
      <template v-if="editable">
        <button v-if="item.type === 'shopping'" :class="[popping && 'pop',
          'h-8 rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150',
          item.status === 'bought' ? 'border-transparent bg-accent-soft text-accent'
          : item.status === 'not_found' ? 'border-transparent bg-line text-muted' : 'border-line text-ink']"
          @click="fire('status')">{{ STATUS[item.status] }}</button>
        <button v-else :class="[popping && 'pop',
          'flex size-9 items-center justify-center rounded-full border transition-colors duration-150',
          item.visited ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-muted']"
          :aria-label="item.visited ? '取消已去過' : '標記已去過'" @click="fire('visited')"><PhCheck :size="17" weight="bold" /></button>
      </template>
      <div class="flex-1" aria-hidden="true" />
      <!-- 開啟連結 / 複製 / 編輯 / 刪除 全部收在抽屜裡，卡片只留最常用的狀態鈕 -->
      <button class="icon-btn size-8 text-muted" aria-label="更多動作" @click="$emit('menu')"><PhDotsThreeVertical :size="18" weight="bold" /></button>
    </div>
  </article>
</template>
