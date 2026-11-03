<script setup>
import { PhX, PhPlus } from '@phosphor-icons/vue'
import { MAX_RANGES, CLOSED_DAYS, cleanClosed } from '../hours-rules'
import TimeField from './TimeField.vue'

// 營業時間欄：好幾段「開始–結束」＋公休日。清單表單與行程表單共用。
// hours 陣列由呼叫端擁有，這裡直接改它；公休日用 v-model:closed-days 傳回去。
// 存檔前呼叫端要過 cleanHours：只填一格的時段這裡不擋，讓使用者可以先填一半。
const props = defineProps({ hours: Array, closedDays: Array })
const emit = defineEmits(['update:closedDays'])
const add = () => { if (props.hours.length < MAX_RANGES) props.hours.push({ open: '', close: '' }) }

// 公休日可以選好幾天（有些店一週休兩天）。「無」跟星期幾互斥：點了無就清掉星期幾，點了星期幾就清掉無
const on = k => (props.closedDays ?? []).includes(k)
function toggleDay(k) {
  const days = props.closedDays ?? []
  if (k === 'none') return emit('update:closedDays', on('none') ? [] : ['none'])
  emit('update:closedDays', cleanClosed(on(k) ? days.filter(d => d !== k) : [...days.filter(d => d !== 'none'), k]))
}
</script>

<template>
  <div>
    <span class="label">營業時間（選填）</span>
    <!-- 手機上一列要塞兩格時間、一個連字號、一顆刪除鈕，輸入框的內距縮小，不然「下午 05:00」會被切掉 -->
    <div v-for="(r, i) in hours" :key="i" class="mb-2 flex items-center gap-1.5">
      <TimeField v-model="r.open" class="flex-1" input-class="min-w-0 px-2 text-[15px]" :aria-label="`第 ${i + 1} 段開始`" />
      <span class="shrink-0 text-muted" aria-hidden="true">–</span>
      <TimeField v-model="r.close" class="flex-1" input-class="min-w-0 px-2 text-[15px]" :aria-label="`第 ${i + 1} 段結束`" />
      <button class="icon-btn size-7 shrink-0 text-muted" :aria-label="`移除第 ${i + 1} 段`" @click="hours.splice(i, 1)"><PhX :size="16" /></button>
    </div>
    <!-- 中午休息的餐廳要兩段以上，所以時段可以一直加 -->
    <button v-if="hours.length < MAX_RANGES" class="btn-ghost h-9 w-full text-[14px]" @click="add">
      <PhPlus :size="16" weight="bold" />{{ hours.length ? '再加一段（中間休息）' : '新增營業時段' }}
    </button>

    <!-- 都不選＝沒填，畫面不顯示；「無」顯示全年無休 -->
    <span class="label mt-3">公休日（選填，可以選好幾天）</span>
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="公休日">
      <button v-for="[k, l] in CLOSED_DAYS" :key="k" type="button" :aria-pressed="on(k)"
        :class="['chip-state h-8 px-3 text-[14px]', on(k) && 'on']" @click="toggleDay(k)">{{ l }}</button>
    </div>
  </div>
</template>
