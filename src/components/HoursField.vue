<script setup>
import { PhX, PhPlus } from '@phosphor-icons/vue'
import { MAX_RANGES, CLOSED_DAYS } from '../hours-rules'

// 營業時間欄：好幾段「開始–結束」＋公休日下拉。清單表單與行程表單共用。
// hours 陣列由呼叫端擁有，這裡直接改它；公休日是單一值，用 v-model:closed-day 傳回去。
// 存檔前呼叫端要過 cleanHours：只填一格的時段這裡不擋，讓使用者可以先填一半。
const props = defineProps({ hours: Array, closedDay: String })
const emit = defineEmits(['update:closedDay'])
const add = () => { if (props.hours.length < MAX_RANGES) props.hours.push({ open: '', close: '' }) }
</script>

<template>
  <div>
    <span class="label">營業時間（選填）</span>
    <!-- 手機上一列要塞兩格時間、一個連字號、一顆刪除鈕，輸入框的內距縮小，不然「下午 05:00」會被切掉 -->
    <div v-for="(r, i) in hours" :key="i" class="mb-2 flex items-center gap-1.5">
      <input v-model="r.open" type="time" class="input min-w-0 flex-1 px-2 text-[15px]" :aria-label="`第 ${i + 1} 段開始`" />
      <span class="shrink-0 text-muted" aria-hidden="true">–</span>
      <input v-model="r.close" type="time" class="input min-w-0 flex-1 px-2 text-[15px]" :aria-label="`第 ${i + 1} 段結束`" />
      <button class="icon-btn size-7 shrink-0 text-muted" :aria-label="`移除第 ${i + 1} 段`" @click="hours.splice(i, 1)"><PhX :size="16" /></button>
    </div>
    <!-- 中午休息的餐廳要兩段以上，所以時段可以一直加 -->
    <button v-if="hours.length < MAX_RANGES" class="btn-ghost h-9 w-full text-[14px]" @click="add">
      <PhPlus :size="16" weight="bold" />{{ hours.length ? '再加一段（中間休息）' : '新增營業時段' }}
    </button>

    <label class="label mt-3" for="closed-day">公休日（選填）</label>
    <!-- 「請選擇」＝沒選，存成 null，畫面不顯示；「無」存成 'none'，顯示全年無休 -->
    <select id="closed-day" class="input" :value="closedDay ?? ''" @change="e => emit('update:closedDay', e.target.value || null)">
      <option value="">請選擇</option>
      <option v-for="[k, l] in CLOSED_DAYS" :key="k" :value="k">{{ l }}</option>
    </select>
  </div>
</template>
