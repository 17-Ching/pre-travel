<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { PhClock, PhX } from '@phosphor-icons/vue'

// 時間欄（'HH:MM'，空字串＝沒填）。
// 手機：原生 <input type="time">，iOS / Android 的滾輪本來就好用，不要重做。
// 電腦：原生的要一格一格點時、分、上下午，很難用，所以換成「可以直接打字＋下拉選時、分」：
//   - 直接打「930」「0930」「9:30」「17」都會被整理成 HH:MM
//   - 點欄位任何地方打開面板，左邊選時、右邊選分（5 分鐘一格，打字可以填任何分鐘）
const props = defineProps({ modelValue: String, ariaLabel: String, id: String, inputClass: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const desktop = matchMedia('(pointer: fine)').matches

const open = ref(false)
// 打字中的內容。null＝這次沒打字：離開欄位時不能把它當成「清空」，不然點一下別格就把時間洗掉了
const draft = ref(null)
const root = ref()
const hh = computed(() => props.modelValue?.slice(0, 2) ?? '')
const mm = computed(() => props.modelValue?.slice(3, 5) ?? '')
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

// 打字的整理：只看數字。1–2 碼當小時，3–4 碼最後兩碼是分鐘。超出範圍就當沒填，不要亂猜
function parse(text) {
  const d = (text ?? '').replace(/\D/g, '')
  if (!d) return ''
  const h = d.length <= 2 ? +d : +d.slice(0, -2)
  const m = d.length <= 2 ? 0 : +d.slice(-2)
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null
}
function commit() {
  if (draft.value === null) return
  const v = parse(draft.value)
  if (v !== null) emit('update:modelValue', v)
  draft.value = null
}
function pick(h, m) { draft.value = null; emit('update:modelValue', `${h}:${m}`) }
function pickHour(h) { pick(h, mm.value || '00') }
function pickMinute(m) { pick(hh.value || '12', m); open.value = false }

// 打開時把選到的那一格捲到中間，不然 23 點要往下捲很久
const hourCol = ref(), minCol = ref()
async function show() {
  if (open.value) return
  open.value = true
  await nextTick()
  for (const col of [hourCol.value, minCol.value]) col?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
}
const onDoc = e => { if (!root.value?.contains(e.target)) open.value = false }
document.addEventListener('pointerdown', onDoc)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDoc))
</script>

<template>
  <input v-if="!desktop" :id="id" type="time" :value="modelValue" :aria-label="ariaLabel" :class="['input', inputClass]"
    @input="e => emit('update:modelValue', e.target.value)" />

  <div v-else ref="root" class="relative min-w-0" @keydown.esc="open = false">
    <input :id="id" :value="draft ?? modelValue" :aria-label="ariaLabel" placeholder="--:--" inputmode="numeric" autocomplete="off"
      :class="['input cursor-pointer pr-14 tabular-nums', inputClass]"
      @focus="show" @click="show" @input="e => (draft = e.target.value)" @blur="commit" @keydown.enter.prevent="commit(); open = false" />
    <button v-if="modelValue" type="button" class="absolute right-8 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-ink" aria-label="清除時間"
      @click="emit('update:modelValue', ''); open = false"><PhX :size="12" weight="bold" /></button>
    <PhClock :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />

    <div v-if="open" class="absolute left-0 top-full z-30 mt-1 flex h-56 w-44 overflow-hidden rounded-[14px] border border-line bg-card shadow-e2">
      <div ref="hourCol" class="flex-1 overflow-y-auto p-1" role="listbox" aria-label="時">
        <button v-for="h in HOURS" :key="h" type="button" role="option" :aria-selected="h === hh"
          :class="['block w-full rounded-[8px] py-1.5 text-center text-[14px] tabular-nums', h === hh ? 'bg-accent font-semibold text-accent-fg' : 'hover:bg-surface-2']"
          @mousedown.prevent @click="pickHour(h)">{{ h }}</button>
      </div>
      <div ref="minCol" class="flex-1 overflow-y-auto border-l border-line p-1" role="listbox" aria-label="分">
        <button v-for="m in MINUTES" :key="m" type="button" role="option" :aria-selected="m === mm"
          :class="['block w-full rounded-[8px] py-1.5 text-center text-[14px] tabular-nums', m === mm ? 'bg-accent font-semibold text-accent-fg' : 'hover:bg-surface-2']"
          @mousedown.prevent @click="pickMinute(m)">{{ m }}</button>
      </div>
    </div>
  </div>
</template>
