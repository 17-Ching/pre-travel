<script setup>
import { computed, ref } from 'vue'
import { PhPlus, PhArrowRight, PhCheck, PhPencilSimple, PhTrash, PhArrowBendDownLeft } from '@phosphor-icons/vue'
import { store, prefs, user, me, tripMembers, tripCurrencies, todayISO, toast,
  groupExpenses, myExpenses, addedToMine, saveExpense, deleteExpense, addShareToMine, toggleSettled, settlePair,
  splitEven, debts, totals, fmtMoney, decimalsOf } from '../store'
import { WEEK, parseDate } from '../date-rules'
import Avatar from './Avatar.vue'
import Sheet from './Sheet.vue'

const props = defineProps({ tripId: String })
const p = prefs(props.tripId)
p.ledger ??= 'group'
const isGroup = computed(() => p.ledger === 'group')

const list = computed(() => (isGroup.value ? groupExpenses(props.tripId) : myExpenses(props.tripId)))
// 共同帳的總額是整筆，我的記帳是我自己記的金額（加進來的分攤就是我那份）
const sums = computed(() => totals(list.value))
const owed = computed(() => debts(groupExpenses(props.tripId)))
const byDate = computed(() => {
  const m = new Map()
  for (const e of list.value) m.set(e.date, [...(m.get(e.date) ?? []), e])
  return [...m]
})
const dayLabel = iso => `${iso.slice(5).replace('-', '/')}（${WEEK[parseDate(iso).getDay()]}）`
const nameOf = id => (id === store.me ? '我' : user(id)?.name ?? '?')
const online = () => (store.offline ? (toast('需要網路'), false) : true)

const form = ref(null)   // 新增／編輯中的帳目，null＝抽屜關著
// 能選的人：還在的成員。編輯舊帳時，已經離開但在分攤裡的人也要列出來，不然存一次他就被踢掉了
const people = computed(() => {
  const ids = [store.me, ...tripMembers(props.tripId).filter(m => m.status === 'active' && m.userId !== store.me).map(m => m.userId)]
  for (const s of form.value?.origShares ?? []) if (!ids.includes(s.userId)) ids.push(s.userId)
  return ids
})

// ── 帳目明細（共同帳才有，要看誰付清了沒）
const detail = ref(null)
const myShare = computed(() => detail.value?.shares.find(s => s.userId === store.me))
const settledCount = e => e.shares.filter(s => s.settled && s.userId !== e.payerId).length
const owingCount = e => e.shares.filter(s => s.userId !== e.payerId).length
function open(e) { e.kind === 'group' ? (detail.value = e) : edit(e) }
function toggle(userId) { if (online()) toggleSettled(detail.value, userId) }
function addMine() {
  if (!online()) return
  addShareToMine(detail.value)
  toast('已加入我的記帳')
}
function settle(d) {
  if (!online()) return
  if (!confirm(`${nameOf(d.from)} 已經把 ${fmtMoney(d.amount, d.currency)} 給 ${nameOf(d.to)} 了？`)) return
  settlePair(props.tripId, d.from, d.to, d.currency)
  toast('已結清')
}

// ── 新增 / 編輯
function openNew() {
  if (!online()) return
  const currency = tripCurrencies(props.tripId)[0]
  form.value = {
    kind: isGroup.value ? 'group' : 'personal', title: '', amount: '', currency, date: todayISO(), note: '',
    payerId: store.me, mode: 'even', who: [...people.value], custom: {}, origShares: [],
  }
}
function edit(e) {
  if (!online()) return
  detail.value = null
  const who = e.shares.map(s => s.userId)
  const even = splitEven(e.amount, who, e.payerId, e.currency)
  form.value = {
    id: e.id, kind: e.kind, title: e.title, amount: String(e.amount), currency: e.currency, date: e.date, note: e.note,
    payerId: e.payerId, sourceExpenseId: e.sourceExpenseId,
    // 存的時候是均分算出來的就回到均分，不然打開編輯會莫名變成自訂
    mode: e.shares.every((s, i) => s.amount === even[i]) ? 'even' : 'custom',
    who, custom: Object.fromEntries(e.shares.map(s => [s.userId, String(s.amount)])), origShares: e.shares,
  }
}

const amount = computed(() => Number(form.value?.amount))
// 日幣這種沒有小數的幣別不收小數點，其他最多到分
const amountOk = computed(() => (decimalsOf(form.value.currency) ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(form.value.amount.trim())
  && amount.value > 0 && amount.value < 1e9)
const shares = computed(() => {
  const f = form.value
  if (!f || f.kind !== 'group') return []
  if (f.mode === 'even') {
    const ids = people.value.filter(id => f.who.includes(id))
    const amounts = amountOk.value ? splitEven(amount.value, ids, f.payerId, f.currency) : ids.map(() => 0)
    return ids.map((userId, i) => ({ userId, amount: amounts[i] }))
  }
  return people.value.map(userId => ({ userId, amount: Number(f.custom[userId]) || 0 })).filter(s => s.amount > 0)
})
// 自訂金額：還差多少才湊到總額。存不存得了就看這個是不是 0
const left = computed(() => {
  const f = form.value
  const sum = shares.value.reduce((s, x) => s + x.amount, 0)
  return Math.round((amount.value - sum) * 10 ** decimalsOf(f.currency)) / 10 ** decimalsOf(f.currency)
})
const canSave = computed(() => {
  const f = form.value
  if (!f?.title.trim() || !amountOk.value || !f.date) return false
  return f.kind === 'personal' || (shares.value.length > 0 && (f.mode === 'even' || left.value === 0))
})
// 切到自訂時先帶入均分的結果，通常只是把其中一兩個人改掉，不用從零開始填
function useCustom() {
  const f = form.value
  if (f.mode === 'custom') return
  if (amountOk.value) f.custom = Object.fromEntries(shares.value.map(s => [s.userId, String(s.amount)]))
  f.mode = 'custom'
}
function toggleWho(id) {
  const w = form.value.who
  w.includes(id) ? w.splice(w.indexOf(id), 1) : w.push(id)
}
function save() {
  const f = form.value
  const prev = new Map(f.origShares.map(s => [s.userId, s.settled]))
  saveExpense({
    id: f.id, tripId: props.tripId, kind: f.kind, title: f.title.trim(), amount: amount.value, currency: f.currency,
    date: f.date, note: f.note.trim(),
    payerId: f.kind === 'group' ? f.payerId : null,
    ownerUserId: f.kind === 'personal' ? store.me : null,
    sourceExpenseId: f.sourceExpenseId ?? null,
    shares: shares.value.map(s => ({ ...s, settled: prev.get(s.userId) ?? false })),
  })
  form.value = null
}
function remove() {
  const f = form.value
  if (!confirm(`刪除「${f.title}」？`)) return
  deleteExpense(f.id)
  form.value = null
  toast('已刪除')
}

const segCls = on => ['relative z-10 flex h-8 items-center justify-center rounded-[9px] text-[14px] font-semibold transition-colors duration-150', on ? 'text-ink' : 'text-muted']
</script>

<template>
  <div class="gutter pb-2 pt-2">
    <div class="relative grid grid-cols-2 rounded-[12px] bg-surface-2 p-1">
      <div class="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-[9px] bg-card shadow-e1 transition-transform duration-200 ease-out"
        :style="{ transform: `translateX(${isGroup ? 0 : 100}%)` }" aria-hidden="true" />
      <button :class="segCls(isGroup)" @click="p.ledger = 'group'">共同</button>
      <button :class="segCls(!isGroup)" @click="p.ledger = 'me'">我的</button>
    </div>
  </div>
  <div class="h-px w-full bg-line" />

  <main class="gutter pb-32 pt-4">
    <p v-if="sums.length" class="text-[13px] tabular-nums text-muted">
      {{ isGroup ? '共同花費' : '我花了' }} <span class="font-semibold text-ink">{{ sums.map(([c, n]) => fmtMoney(n, c)).join('・') }}</span>
    </p>
    <p v-if="!isGroup" class="mt-1 text-[12px] text-muted">只有你自己看得到</p>

    <!-- 結算：兩兩抵銷後還欠多少。按「結清」把兩人之間的分攤全部勾成已付清 -->
    <section v-if="isGroup && list.length" class="card mt-3 p-3">
      <h3 class="text-[13px] font-semibold tracking-wide text-muted">結算</h3>
      <p v-if="!owed.length" class="mt-1.5 text-[14px]">大家都結清了 🎉</p>
      <ul v-else class="mt-1 grid">
        <li v-for="d in owed" :key="`${d.currency}${d.from}${d.to}`" class="flex items-center gap-2 py-1.5">
          <Avatar :user="user(d.from)" :size="22" /><span class="min-w-0 truncate text-[14px]">{{ nameOf(d.from) }}</span>
          <PhArrowRight :size="14" class="shrink-0 text-muted" />
          <Avatar :user="user(d.to)" :size="22" /><span class="min-w-0 truncate text-[14px]">{{ nameOf(d.to) }}</span>
          <span class="ml-auto shrink-0 text-[15px] font-semibold tabular-nums">{{ fmtMoney(d.amount, d.currency) }}</span>
          <button class="chip-state shrink-0" @click="settle(d)">結清</button>
        </li>
      </ul>
    </section>

    <div v-if="!list.length" class="mt-14 text-center">
      <p class="text-[17px] font-semibold">{{ isGroup ? '還沒有共同帳' : '還沒有記帳' }}</p>
      <p class="mt-1.5 text-[14px] leading-relaxed text-muted">
        {{ isGroup ? '誰先付了錢就記一筆，大家要分多少自動算好。' : '按右下角的加號記一筆，或從共同帳把你那份加進來。' }}
      </p>
    </div>

    <section v-for="[d, items] in byDate" :key="d" class="mt-5">
      <h2 class="mb-1.5 text-[13px] font-semibold tracking-wide text-muted">{{ dayLabel(d) }}</h2>
      <ul class="grid gap-2">
        <li v-for="e in items" :key="e.id">
          <button class="card flex w-full items-center gap-3 p-3 text-left transition duration-150 active:scale-[0.99]" @click="open(e)">
            <Avatar v-if="e.kind === 'group'" :user="user(e.payerId)" :size="32" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15px] font-semibold">{{ e.title }}</span>
              <span class="mt-0.5 block truncate text-[12px] text-muted">
                <template v-if="e.kind === 'group'">
                  {{ nameOf(e.payerId) }} 付・{{ e.shares.length }} 人分<template v-if="owingCount(e)">・已付清 {{ settledCount(e) }}/{{ owingCount(e) }}</template>
                </template>
                <template v-else-if="e.sourceExpenseId">來自共同帳</template>
                <template v-else-if="e.note">{{ e.note }}</template>
              </span>
            </span>
            <span class="shrink-0 text-[15px] font-semibold tabular-nums">{{ fmtMoney(e.amount, e.currency) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </main>

  <button aria-label="記一筆" @click="openNew"
    :class="['fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[max(1.5rem,calc(50vw-360px+1.5rem))] z-30 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-e2 transition duration-150 active:scale-90', store.offline && 'opacity-40']">
    <PhPlus :size="26" weight="bold" />
  </button>

  <!-- 共同帳明細：每個人的分攤與付清狀態，誰都可以勾 -->
  <Sheet :open="!!detail" :title="detail?.title" @update:open="v => !v && (detail = null)">
    <div v-if="detail" class="px-3 pb-2">
      <p class="text-[24px] font-semibold tabular-nums">{{ fmtMoney(detail.amount, detail.currency) }}</p>
      <p class="mt-0.5 text-[13px] text-muted">{{ dayLabel(detail.date) }}・{{ nameOf(detail.payerId) }} 先付</p>
      <p v-if="detail.note" class="mt-2 whitespace-pre-line text-[14px]">{{ detail.note }}</p>

      <ul class="mt-3 grid border-t border-line pt-1">
        <li v-for="s in detail.shares" :key="s.userId" class="flex h-12 items-center gap-2.5">
          <Avatar :user="user(s.userId)" :size="26" />
          <span class="min-w-0 flex-1 truncate text-[15px]">{{ nameOf(s.userId) }}</span>
          <span class="shrink-0 text-[15px] tabular-nums">{{ fmtMoney(s.amount, detail.currency) }}</span>
          <span v-if="s.userId === detail.payerId" class="w-[72px] shrink-0 text-center text-[12px] text-muted">付款人</span>
          <button v-else :class="['chip-state w-[72px] shrink-0 justify-center', s.settled && 'on']" :aria-pressed="s.settled" @click="toggle(s.userId)">
            <PhCheck v-if="s.settled" :size="12" weight="bold" />{{ s.settled ? '已付清' : '未付清' }}
          </button>
        </li>
      </ul>

      <button v-if="myShare" class="row mt-1 border-t border-line pt-1" :disabled="addedToMine(detail.id)" @click="addMine">
        <PhArrowBendDownLeft :size="20" class="text-muted" />
        <span class="flex-1">{{ addedToMine(detail.id) ? '已加入我的記帳' : `把我的 ${fmtMoney(myShare.amount, detail.currency)} 加入我的記帳` }}</span>
      </button>
      <button class="row" @click="edit(detail)"><PhPencilSimple :size="20" class="text-muted" /><span class="flex-1">編輯</span></button>
    </div>
  </Sheet>

  <Sheet :open="!!form" :title="form?.id ? '編輯帳目' : form?.kind === 'group' ? '記一筆共同帳' : '記一筆'" @update:open="v => !v && (form = null)">
    <div v-if="form" class="grid gap-4 px-3 pb-2">
      <div>
        <label class="label" for="x-title">項目</label>
        <input id="x-title" v-model="form.title" class="input" maxlength="100" placeholder="例：一蘭拉麵、Suica 儲值" />
      </div>
      <div>
        <label class="label" for="x-amount">金額</label>
        <div class="flex gap-2">
          <input id="x-amount" v-model="form.amount" class="input min-w-0 flex-1 tabular-nums" inputmode="decimal" placeholder="0" />
          <button v-for="c in tripCurrencies(tripId)" :key="c" :class="['chip-state shrink-0 self-center', form.currency === c && 'on']"
            @click="form.currency = c">{{ c }}</button>
        </div>
      </div>
      <div>
        <label class="label" for="x-date">日期</label>
        <input id="x-date" v-model="form.date" type="date" class="input" />
      </div>

      <template v-if="form.kind === 'group'">
        <div>
          <span class="label">誰先付的</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="id in people" :key="id" :class="['chip-state', form.payerId === id && 'on']" @click="form.payerId = id">
              <Avatar :user="user(id)" :size="18" />{{ nameOf(id) }}
            </button>
          </div>
        </div>
        <div>
          <div class="mb-1.5 flex items-center gap-2">
            <span class="label mb-0 flex-1">怎麼分</span>
            <button :class="['chip-state', form.mode === 'even' && 'on']" @click="form.mode = 'even'">均分</button>
            <button :class="['chip-state', form.mode === 'custom' && 'on']" @click="useCustom">自訂金額</button>
          </div>
          <ul class="grid">
            <li v-for="id in people" :key="id" class="flex h-12 items-center gap-2.5">
              <Avatar :user="user(id)" :size="26" />
              <span class="min-w-0 flex-1 truncate text-[15px]">{{ nameOf(id) }}</span>
              <template v-if="form.mode === 'even'">
                <span class="shrink-0 text-[14px] tabular-nums text-muted">
                  {{ form.who.includes(id) && amountOk ? fmtMoney(shares.find(s => s.userId === id)?.amount ?? 0, form.currency) : '' }}
                </span>
                <input type="checkbox" class="size-5 shrink-0 accent-accent" :checked="form.who.includes(id)"
                  :aria-label="`${nameOf(id)} 有份`" @change="toggleWho(id)" />
              </template>
              <input v-else v-model="form.custom[id]" class="input h-9 w-28 shrink-0 text-right tabular-nums" inputmode="decimal" placeholder="0"
                :aria-label="`${nameOf(id)} 要付多少`" />
            </li>
          </ul>
          <p v-if="form.mode === 'custom' && amountOk && left !== 0" class="mt-1 text-right text-[13px] tabular-nums text-danger">
            {{ left > 0 ? `還差 ${fmtMoney(left, form.currency)}` : `多了 ${fmtMoney(-left, form.currency)}` }}
          </p>
        </div>
      </template>

      <div>
        <label class="label" for="x-note">備註（選填）</label>
        <textarea id="x-note" v-model="form.note" class="input h-20 resize-y py-2.5" maxlength="500" />
      </div>
    </div>

    <template #footer>
      <div class="flex gap-3">
        <button v-if="form?.id" class="btn-danger shrink-0" aria-label="刪除" @click="remove"><PhTrash :size="18" /></button>
        <button class="btn-primary flex-1" :disabled="!canSave" @click="save">儲存</button>
      </div>
    </template>
  </Sheet>
</template>
