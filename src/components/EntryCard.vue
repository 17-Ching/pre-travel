<script setup>
import { computed } from 'vue'
import { PhCheck, PhDotsThreeVertical, PhArrowRight, PhMapPin, PhAirplaneTakeoff, PhBed } from '@phosphor-icons/vue'
import { entryTitle, entryThumb, entryDetached, sourceLabel, firstUrl, arrivesNextDay, user, imageOk, imageBroken } from '../store'
import Avatar from './Avatar.vue'

// badge：住宿用來標「入住 / 第 2 晚 / 退房・共 3 晚」，由呼叫端算好（它才知道現在看的是哪天）
const props = defineProps({ entry: Object, badge: String })
defineEmits(['toggle', 'menu'])

const title = computed(() => entryTitle(props.entry))
const thumb = computed(() => entryThumb(props.entry))
const detached = computed(() => entryDetached(props.entry))
const isFlight = computed(() => props.entry.kind === 'flight')
const isStay = computed(() => props.entry.kind === 'stay')
// 航班跟住宿共用同一套卡片外觀（左側直線 + 淡底），只有圖示與副標不同
const isTransport = computed(() => props.entry.kind !== 'place')
// 一般交通（走路、電車…）自己一套：它不是「一個地點」，是兩點之間的移動，
// 做成跟地點一樣大的卡片會讓時段看起來站點兩倍多。壓成一條細列＋虛線連接。
// 航班與住宿不走這條：它們各自成區，本來就是獨立的一筆，不是誰與誰之間。
const isLeg = computed(() => props.entry.kind === 'transport')
// 誰搭這班。沒指定就是全員，不佔版面
const passengers = computed(() => (props.entry.passengerIds ?? []).map(user).filter(Boolean))
// 連結來源標在縮圖上，跟清單卡片同一套（ItemCard），有沒有東西可看一眼就知道
const source = computed(() => {
  const n = props.entry.links?.length ?? 0
  const s = sourceLabel(firstUrl(props.entry))
  return s && n > 1 ? `${s} +${n - 1}` : s
})
// F-40：有 start_time 才算「有時間」，要一眼看得出來
const timeLabel = computed(() => {
  const { startTime, endTime } = props.entry
  // 住宿的兩個時間不是一段區間，是入住與退房，分開講才看得懂
  if (isStay.value) {
    return [startTime && `入住 ${startTime}`, endTime && `退房 ${endTime}`].filter(Boolean).join('・')
  }
  if (!startTime) return ''
  if (!endTime) return startTime
  // 紅眼航班：抵達比起飛早就是隔天到，不標的話看起來像打錯
  return `${startTime} – ${endTime}${arrivesNextDay(props.entry) ? ' +1' : ''}`
})
</script>

<template>
  <!-- 交通：連接線而不是站點。縮圖那一格換成 44px 寬的細欄，圓點跟上下卡片的
       圖示對齊在同一條垂直線上，虛線穿過去，看起來就是 A 到 B 的那一段路。 -->
  <article v-if="isLeg" :class="['relative flex items-center gap-2.5 py-1 pl-2.5', entry.done && 'opacity-55']">
    <span aria-hidden="true" class="absolute inset-y-0 left-[32px] w-px border-l border-dashed border-tint/45" />
    <button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 text-left" :aria-label="`${title} 的動作`" @click="$emit('menu')">
      <span class="z-10 flex w-11 shrink-0 justify-center">
        <span class="flex size-[22px] items-center justify-center rounded-full bg-tint text-tint-fg">
          <PhArrowRight :size="12" weight="bold" />
        </span>
      </span>
      <span class="min-w-0 flex-1 py-0.5">
        <span class="flex flex-wrap items-baseline gap-x-1.5">
          <span v-if="entry.transportMode" class="text-[13px] font-semibold text-tint">{{ entry.transportMode }}</span>
          <span :class="['min-w-0 truncate text-[13px]', entry.done && 'line-through decoration-1']">{{ title }}</span>
          <span v-if="timeLabel" class="text-[11px] font-medium tabular-nums text-muted">{{ timeLabel }}</span>
        </span>
        <span v-if="entry.note" class="mt-0.5 line-clamp-1 block text-[12px] text-muted">{{ entry.note }}</span>
      </span>
    </button>
    <div class="flex shrink-0 items-center gap-0.5">
      <button :aria-label="entry.done ? '取消完成' : '標記完成'" @click="$emit('toggle')"
        :class="['flex size-7 items-center justify-center rounded-full border transition-colors duration-150',
          entry.done ? 'border-transparent bg-accent text-accent-fg' : 'border-line text-muted']">
        <PhCheck :size="13" weight="bold" />
      </button>
      <button class="icon-btn size-7 text-muted" aria-label="更多動作" @click="$emit('menu')">
        <PhDotsThreeVertical :size="15" weight="bold" />
      </button>
    </div>
  </article>

  <article v-else :class="['relative flex gap-2.5 rounded-[14px] border p-2.5 transition duration-200',
    // F-39：交通用左側直線 + 不同底色，跟一般行程項目明顯區隔
    isTransport ? 'border-dashed border-tint/50 bg-tint-soft/40' : 'border-line bg-card',
    entry.done ? 'opacity-55' : 'shadow-e1']">
    <!-- 交通的左側直線 -->
    <span v-if="isTransport" aria-hidden="true" class="absolute inset-y-3 left-0 w-0.5 rounded-full bg-tint" />

    <!-- 卡片本身就是開抽屜的按鈕，不必瞄準右邊那三個點；勾選鈕在外面，不會被誤觸 -->
    <button type="button" class="flex min-w-0 flex-1 gap-2.5 text-left" :aria-label="`${title} 的動作`" @click="$emit('menu')">
      <span v-if="isTransport" class="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-tint/15 text-tint">
        <component :is="isFlight ? PhAirplaneTakeoff : isStay ? PhBed : PhArrowRight" :size="20" weight="bold" />
      </span>
      <span v-else class="relative size-11 shrink-0">
        <img v-if="imageOk(thumb)" :src="thumb" alt="" loading="lazy" class="size-full rounded-[10px] bg-line object-cover" @error="imageBroken(thumb)" />
        <span v-else class="flex size-full items-center justify-center rounded-[10px] bg-tint-soft text-tint">
          <PhMapPin :size="18" />
        </span>
        <span v-if="source" class="absolute -bottom-1 left-0 max-w-full truncate rounded-md bg-black/65 px-1 py-px text-[9px] font-medium text-white">{{ source }}</span>
      </span>

      <span class="min-w-0 flex-1">
        <!-- 時間徽章放標題上面，掃一眼就知道哪幾筆有約定時間 -->
        <span v-if="badge" class="mb-1 mr-1.5 inline-flex items-center rounded-md bg-tint-soft px-1.5 py-0.5 text-[11px] font-bold text-tint">
          {{ badge }}
        </span>
        <span v-if="timeLabel"
          class="mb-1 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-accent">
          {{ timeLabel }}
        </span>
        <span :class="['line-clamp-2 text-[15px] font-semibold leading-snug', entry.done && 'line-through decoration-1']">{{ title }}</span>
        <span v-if="isTransport && entry.transportMode" class="mt-0.5 block truncate text-[12px] text-tint">{{ entry.transportMode }}</span>
        <!-- 同一天好幾班時，靠這排頭像分辨誰搭哪一班 -->
        <span v-if="passengers.length" class="mt-1 flex flex-wrap items-center gap-1.5">
          <span v-for="u in passengers" :key="u.id" class="inline-flex items-center gap-1 rounded-full bg-tint-soft px-1.5 py-0.5 text-[11px] text-tint">
            <Avatar :user="u" :size="14" />{{ u.name }}
          </span>
        </span>
        <span v-if="entry.note" class="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-relaxed text-muted">{{ entry.note }}</span>
        <!-- F-47：引用的地點被刪掉了，標題留成快照 -->
        <span v-if="detached" class="mt-1 block text-[11px] text-muted">原項目已刪除</span>
      </span>
    </button>

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
