<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { PhPrinter, PhCaretLeft } from '@phosphor-icons/vue'
import { store, trip, tripMembers, user, flag, countryName, tripDays, entriesOf, flightsOf, staysOf, stayDayLabel, stayNights,
  arrivesNextDay, entryTitle, entryThumb, dayNote, dayLinks, dayRefs, linkLabel, thumbOf, imageOk } from '../store'
import LoadState from '../components/LoadState.vue'

// 匯出 PDF：給不用 app 的家人看，也當離線備份。不裝 PDF 套件，排好版用瀏覽器的「列印 → 存成 PDF」。
// 刻意不放：記帳、送禮清單（只有本人看得到）、願望清單（還沒排進行程的東西）、打勾狀態、附件 PDF。
// 顏色寫死成白底黑字，不吃深淺色主題：深色模式下印出來不能是一張黑紙。
const tripId = useRoute().params.tripId
const t = computed(() => trip(tripId))
const members = computed(() => tripMembers(tripId).filter(m => m.status === 'active').map(m => user(m.userId)?.name).filter(Boolean))
const days = computed(() => tripDays(tripId).filter(d => !d.outOfRange))
const byDateTime = (a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '')
const flights = computed(() => store.entries.filter(e => e.tripId === tripId && e.kind === 'flight').sort(byDateTime))
const stays = computed(() => store.entries.filter(e => e.tripId === tripId && e.kind === 'stay').sort(byDateTime))

const SLOTS = [['morning', '早上'], ['afternoon', '下午'], ['evening', '晚上']]
const MEALS = [['breakfast', '早餐'], ['lunch', '午餐'], ['snack', '點心'], ['dinner', '晚餐'], ['late_night', '宵夜']]
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const md = iso => iso.slice(5).replace('-', '/')
const mdw = iso => { const [y, m, d] = iso.split('-').map(Number); return `${md(iso)}（${WEEK[new Date(y, m - 1, d).getDay()]}）` }
const timeOf = e => (e.startTime ? (e.endTime ? `${e.startTime}–${e.endTime}${arrivesNextDay(e) ? ' +1' : ''}` : e.startTime) : '')

// 每天要印的東西，空的時段與餐別不印
const plan = computed(() => days.value.map(d => ({
  ...d,
  flights: flightsOf(tripId, d.date),
  stays: staysOf(tripId, d.date),
  slots: SLOTS.map(([k, label]) => ({ label, entries: entriesOf(tripId, d.date, 'schedule', k) })).filter(s => s.entries.length),
  meals: MEALS.map(([k, label]) => ({ label, entries: entriesOf(tripId, d.date, 'meal', k) })).filter(s => s.entries.length),
  note: dayNote(tripId, d.date),
  links: dayLinks(tripId, d.date),
  refs: dayRefs(tripId, d.date),
})))
const isEmpty = d => !d.flights.length && !d.stays.length && !d.slots.length && !d.meals.length && !d.note && !d.links.length && !d.refs.length
const print = () => window.print()
</script>

<template>
  <template v-if="!store.ready || store.loading || store.loadError || !t">
    <main class="gutter"><LoadState /></main>
  </template>

  <template v-else>
    <!-- 螢幕上才有的工具列，印的時候藏起來 -->
    <div class="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface px-2">
      <RouterLink :to="`/trips/${tripId}`" class="icon-btn" aria-label="返回"><PhCaretLeft :size="22" /></RouterLink>
      <p class="min-w-0 flex-1 truncate text-[13px] text-muted">預覽。按右邊的按鈕，在列印畫面選「存成 PDF」</p>
      <button class="btn-primary h-9 shrink-0 px-3 text-[14px]" @click="print"><PhPrinter :size="18" />存成 PDF</button>
    </div>

    <article class="print-doc mx-auto max-w-[720px] bg-white px-6 py-8 text-[13px] leading-relaxed text-neutral-900">
      <header class="border-b-2 border-neutral-900 pb-3">
        <h1 class="text-[24px] font-bold leading-tight">{{ t.name }}</h1>
        <p class="mt-1 text-neutral-600">
          {{ flag(t.country) }} {{ countryName(t.country) }}・{{ mdw(t.start) }} – {{ mdw(t.end) }}・{{ days.length }} 天
        </p>
        <p v-if="members.length" class="text-neutral-600">同行：{{ members.join('、') }}</p>
      </header>

      <!-- 家人最常問的：哪天飛、住哪裡，放最前面 -->
      <section v-if="flights.length || stays.length" class="avoid-break mt-5">
        <h2 class="mb-1.5 text-[15px] font-bold">航班與住宿</h2>
        <table class="w-full border-collapse text-left">
          <tbody>
            <tr v-for="f in flights" :key="f.id" class="border-b border-neutral-200 align-top">
              <td class="w-16 py-1.5 pr-2 font-semibold">✈️ 航班</td>
              <td class="w-24 py-1.5 pr-2 tabular-nums">{{ mdw(f.date) }}</td>
              <td class="py-1.5">
                <span class="font-semibold">{{ f.title }}</span>
                <span v-if="f.transportMode">・{{ f.transportMode }}</span>
                <span v-if="timeOf(f)" class="tabular-nums">・{{ timeOf(f) }}</span>
                <span v-if="f.passengerIds?.length" class="text-neutral-600">（{{ f.passengerIds.map(id => user(id)?.name).filter(Boolean).join('、') }}）</span>
                <span v-if="f.note" class="block whitespace-pre-line text-neutral-600">{{ f.note }}</span>
              </td>
            </tr>
            <tr v-for="s in stays" :key="s.id" class="border-b border-neutral-200 align-top">
              <td class="py-1.5 pr-2 font-semibold">🛏️ 住宿</td>
              <td class="py-1.5 pr-2 tabular-nums">{{ md(s.date) }} – {{ md(s.endDate) }}</td>
              <td class="py-1.5">
                <span class="font-semibold">{{ entryTitle(s) }}</span>・{{ stayNights(s) }} 晚
                <span v-if="s.startTime || s.endTime" class="tabular-nums">・入住 {{ s.startTime || '—' }} / 退房 {{ s.endTime || '—' }}</span>
                <span v-if="s.note" class="block whitespace-pre-line text-neutral-600">{{ s.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-for="d in plan" :key="d.date" class="mt-6">
        <h2 class="avoid-break border-b border-neutral-400 pb-1 text-[16px] font-bold">
          Day {{ d.dayNo }}<span class="ml-2 font-normal text-neutral-600">{{ mdw(d.date) }}</span>
        </h2>
        <p v-if="isEmpty(d)" class="mt-2 text-neutral-500">還沒排</p>

        <p v-for="s in d.stays" :key="s.id" class="mt-2 text-neutral-700">🛏️ {{ entryTitle(s) }}（{{ stayDayLabel(s, d.date) }}）</p>
        <p v-for="f in d.flights" :key="f.id" class="mt-1 text-neutral-700">
          ✈️ {{ f.title }}<span v-if="f.transportMode">・{{ f.transportMode }}</span><span v-if="timeOf(f)" class="tabular-nums">・{{ timeOf(f) }}</span>
        </p>

        <!-- 行程三時段，交通是一行箭頭 -->
        <div v-for="s in d.slots" :key="s.label" class="avoid-break mt-3">
          <h3 class="text-[13px] font-bold text-neutral-600">{{ s.label }}</h3>
          <ul class="mt-1 grid gap-1.5">
            <li v-for="e in s.entries" :key="e.id" class="flex gap-2.5">
              <template v-if="e.kind === 'transport'">
                <span class="w-10 shrink-0 text-center text-neutral-500">↓</span>
                <span class="text-neutral-600">{{ e.transportMode }}<span v-if="e.transportMode && e.title">・</span>{{ e.title }}<span v-if="timeOf(e)" class="tabular-nums">・{{ timeOf(e) }}</span></span>
              </template>
              <template v-else>
                <img v-if="imageOk(entryThumb(e))" :src="entryThumb(e)" alt="" class="size-10 shrink-0 rounded object-cover" />
                <span v-else class="w-10 shrink-0" />
                <span class="min-w-0 flex-1">
                  <span v-if="timeOf(e)" class="mr-1.5 font-semibold tabular-nums">{{ timeOf(e) }}</span>
                  <span class="font-semibold">{{ entryTitle(e) }}</span>
                  <span v-if="e.note" class="block whitespace-pre-line text-neutral-600">{{ e.note }}</span>
                  <span v-if="e.links?.length" class="block text-neutral-600">
                    <a v-for="(l, i) in e.links" :key="l.id" :href="l.url" class="underline">{{ linkLabel(l) }}<span v-if="i < e.links.length - 1">、</span></a>
                  </span>
                </span>
              </template>
            </li>
          </ul>
        </div>

        <!-- 餐食是候選清單，每餐一行列出店名就好 -->
        <div v-if="d.meals.length" class="avoid-break mt-3">
          <h3 class="text-[13px] font-bold text-neutral-600">餐食備選</h3>
          <ul class="mt-1 grid gap-1.5">
            <li v-for="m in d.meals" :key="m.label" class="flex gap-2.5">
              <span class="w-10 shrink-0 font-semibold">{{ m.label }}</span>
              <span class="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1">
                <span v-for="e in m.entries" :key="e.id" class="inline-flex items-center gap-1.5">
                  <img v-if="imageOk(entryThumb(e))" :src="entryThumb(e)" alt="" class="size-6 rounded object-cover" />
                  {{ entryTitle(e) }}<span v-if="timeOf(e)" class="tabular-nums text-neutral-600">（{{ timeOf(e) }}）</span>
                </span>
              </span>
            </li>
          </ul>
        </div>

        <!-- 每日備註：文字、自己加的連結與圖、引用的參考 -->
        <div v-if="d.note || d.links.length || d.refs.length" class="avoid-break mt-3 rounded border border-neutral-300 p-2.5">
          <h3 class="text-[13px] font-bold text-neutral-600">這天的備註</h3>
          <p v-if="d.note" class="mt-1 whitespace-pre-line">{{ d.note }}</p>
          <ul v-if="d.links.length || d.refs.length" class="mt-1.5 grid gap-1.5">
            <li v-for="l in d.links" :key="l.id" class="flex items-center gap-2">
              <img v-if="imageOk(thumbOf(l.images?.[0]))" :src="thumbOf(l.images[0])" alt="" class="size-8 shrink-0 rounded object-cover" />
              <a v-if="l.url?.trim()" :href="l.url" class="underline">{{ linkLabel(l) }}</a>
              <span v-else>{{ l.title }}</span>
            </li>
            <li v-for="r in d.refs" :key="r.id" class="flex items-center gap-2">
              <img v-if="imageOk(thumbOf(r.images[0]))" :src="thumbOf(r.images[0])" alt="" class="size-8 shrink-0 rounded object-cover" />
              <span>🎬 {{ r.title }}</span>
              <a v-if="r.links[0]?.url" :href="r.links[0].url" class="text-neutral-600 underline">{{ linkLabel(r.links[0]) }}</a>
            </li>
          </ul>
        </div>
      </section>

      <footer class="mt-8 border-t border-neutral-300 pt-2 text-[11px] text-neutral-500">由 Onway 匯出</footer>
    </article>
  </template>
</template>
