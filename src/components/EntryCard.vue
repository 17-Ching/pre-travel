<script setup>
import { computed } from 'vue'
import { PhCheck, PhDotsThreeVertical, PhArrowRight, PhMapPin } from '@phosphor-icons/vue'
import { entryTitle, entryThumb, entryDetached } from '../store'

const props = defineProps({ entry: Object })
defineEmits(['toggle', 'menu'])

const title = computed(() => entryTitle(props.entry))
const thumb = computed(() => entryThumb(props.entry))
const detached = computed(() => entryDetached(props.entry))
const isTransport = computed(() => props.entry.kind === 'transport')
// F-40：有 start_time 才算「有時間」，要一眼看得出來
const timeLabel = computed(() => {
  const { startTime, endTime } = props.entry
  if (!startTime) return ''
  return endTime ? `${startTime} – ${endTime}` : startTime
})
</script>

<template>
  <article :class="['relative flex gap-2.5 rounded-[14px] border p-2.5 transition duration-200',
    // F-39：交通用左側直線 + 不同底色，跟一般行程項目明顯區隔
    isTransport ? 'border-dashed border-tint/50 bg-tint-soft/40' : 'border-line bg-card',
    entry.done ? 'opacity-55' : 'shadow-e1']">
    <!-- 交通的左側直線 -->
    <span v-if="isTransport" aria-hidden="true" class="absolute inset-y-3 left-0 w-0.5 rounded-full bg-tint" />

    <div v-if="isTransport" class="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-tint/15 text-tint">
      <PhArrowRight :size="20" weight="bold" />
    </div>
    <img v-else-if="thumb" :src="thumb" alt="" loading="lazy" class="size-11 shrink-0 rounded-[10px] bg-line object-cover" />
    <div v-else class="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-tint-soft text-tint">
      <PhMapPin :size="18" />
    </div>

    <div class="min-w-0 flex-1">
      <!-- 時間徽章放標題上面，掃一眼就知道哪幾筆有約定時間 -->
      <span v-if="timeLabel"
        class="mb-1 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-accent">
        {{ timeLabel }}
      </span>
      <h4 :class="['line-clamp-2 text-[15px] font-semibold leading-snug', entry.done && 'line-through decoration-1']">{{ title }}</h4>
      <p v-if="isTransport && entry.transportMode" class="mt-0.5 truncate text-[12px] text-tint">{{ entry.transportMode }}</p>
      <p v-if="entry.note" class="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-relaxed text-muted">{{ entry.note }}</p>
      <!-- F-47：引用的地點被刪掉了，標題留成快照 -->
      <p v-if="detached" class="mt-1 text-[11px] text-muted">原項目已刪除</p>
    </div>

    <div class="flex shrink-0 flex-col items-end gap-1">
      <button :aria-label="entry.done ? '取消完成' : '標記完成'" @click="$emit('toggle')"
        :class="['flex size-8 items-center justify-center rounded-full border transition-colors duration-150',
          entry.done ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-muted']">
        <PhCheck :size="16" weight="bold" />
      </button>
      <button class="icon-btn size-8 text-muted" aria-label="更多動作" @click="$emit('menu')">
        <PhDotsThreeVertical :size="16" weight="bold" />
      </button>
    </div>
  </article>
</template>
