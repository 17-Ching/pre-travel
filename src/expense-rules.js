// 記帳的純計算：均分、誰欠誰、金額格式。不 import 任何東西，
// scripts/check.mjs 才能直接測（store.js 一載入就會碰 localStorage）。

// 日幣、韓元、越南盾沒有小數；台幣官方有兩位，但實際沒人在用分，所以也當整數
const NO_DECIMALS = ['JPY', 'KRW', 'VND', 'TWD']
export const decimalsOf = currency => (NO_DECIMALS.includes(currency) ? 0 : 2)
export const roundMoney = (n, currency) => {
  const f = 10 ** decimalsOf(currency)
  return Math.round(n * f) / f
}

// 均分。算在最小單位上（日幣是 1 円、美金是 1 分），除不盡的零頭全部給付款人；
// 付款人沒參加這筆的話給第一個人。回傳的順序跟 userIds 一樣，加總一定等於 total。
export function splitEven(total, userIds, payerId, currency) {
  if (!userIds.length) return []
  const f = 10 ** decimalsOf(currency)
  const units = Math.round(total * f)
  const base = Math.floor(units / userIds.length)
  const out = userIds.map(() => base)
  const i = Math.max(0, userIds.indexOf(payerId))
  out[i] += units - base * userIds.length
  return out.map(u => u / f)
}

// 誰欠誰。只看還沒付清的分攤，同一對人在同一個幣別裡互相抵銷，
// 不做跨人的債務簡化：要給誰錢一定是跟那個人之間真的有帳，對得起來。
// expenses: [{ id, payerId, currency, shares: [{ userId, amount, settled }] }]
// 回傳 [{ from, to, currency, amount }]，from 要付給 to
export function debts(expenses) {
  const net = new Map()   // key: 幣別|a|b（a < b），值 > 0 表示 a 欠 b
  for (const e of expenses) {
    for (const s of e.shares) {
      if (s.settled || s.userId === e.payerId) continue
      const [a, b] = [s.userId, e.payerId].sort()
      const key = `${e.currency}|${a}|${b}`
      net.set(key, (net.get(key) ?? 0) + (s.userId === a ? s.amount : -s.amount))
    }
  }
  const out = []
  for (const [key, v] of net) {
    const [currency, a, b] = key.split('|')
    const amount = roundMoney(Math.abs(v), currency)
    if (amount) out.push(v > 0 ? { from: a, to: b, currency, amount } : { from: b, to: a, currency, amount })
  }
  return out
}

// 結算照人看：每個人要付給誰、會收到誰的，各多少。debts() 的每一筆會出現兩次
// （付的人那邊一次、收的人那邊一次）。
// 回傳 [{ id, pay: [debt], receive: [debt] }]，me 排第一個，其他照出現順序
export function byPerson(list, me) {
  const m = new Map()
  const of = id => m.get(id) ?? m.set(id, { id, pay: [], receive: [] }).get(id)
  for (const d of list) {
    of(d.from).pay.push(d)
    of(d.to).receive.push(d)
  }
  return [...m.values()].sort((x, y) => (y.id === me) - (x.id === me))
}

// 幣別的中文名，切換列用。沒列到的就顯示代碼
const CURRENCY_NAME = { TWD: '台幣', JPY: '日幣', KRW: '韓元', THB: '泰銖', VND: '越南盾', SGD: '新幣', HKD: '港幣', MYR: '馬幣',
  USD: '美金', GBP: '英鎊', EUR: '歐元', AUD: '澳幣', NZD: '紐幣', CAD: '加幣' }
export const currencyName = c => CURRENCY_NAME[c] ?? c

// 外幣換算台幣，只當參考（≈ NT$）：帳本身、結算都還是原幣別。
// rates 是旅程共用的那一份 { JPY: { rate, source, at } }，rate＝1 台幣換多少外幣（使用者習慣的講法：
// 「1 台幣換 4.8 日圓」），存的就是使用者填的那個數，不倒過來存，免得來回換算出現 4.8000001。
// 台幣本身、還沒設匯率的幣別回 null，畫面就不顯示
export function toTwd(amount, currency, rates) {
  const rate = currency === 'TWD' ? null : rates?.[currency]?.rate
  return rate ? Math.round(amount / rate) : null
}
// 好幾個幣別合計成台幣。有任何一個外幣沒設匯率就回 null（算一半的總數會誤導）
export function twdTotal(sums, rates) {
  let total = 0
  for (const [c, n] of sums) {
    const t = c === 'TWD' ? n : toTwd(n, c, rates)
    if (t === null) return null
    total += t
  }
  return Math.round(total)
}

// 各幣別加總，給「共同花了多少」「我花了多少」用。回傳 [[幣別, 金額]]
export function totals(list) {
  const m = new Map()
  for (const { currency, amount } of list) m.set(currency, (m.get(currency) ?? 0) + amount)
  return [...m].map(([c, n]) => [c, roundMoney(n, c)])
}

// 記帳類別。固定一組，不給自訂：旅行花費就這幾類，自訂的話每個人取名不一樣，統計就對不起來。
// 第一個值存進資料庫（expenses.category），改名只改後面的字，不要改 key。
// 圖示在 Ledger.vue（這支不碰 Vue，check.mjs 才能直接 import）。
export const CATEGORIES = [
  ['food', '餐飲'], ['transport', '交通'], ['stay', '住宿'],
  ['shopping', '購物'], ['fun', '門票娛樂'], ['other', '其他'],
]
export const categoryOf = key => CATEGORIES.find(([k]) => k === key) ?? CATEGORIES.at(-1)

// 各類別花了多少。幣別分開算（不做匯率換算），同一個幣別裡照金額大到小排，
// 回傳 [{ currency, total, rows: [{ category, amount, ratio }] }]，ratio 給長條圖用
export function byCategory(list) {
  const m = new Map()
  for (const { currency, amount, category } of list) {
    const c = m.get(currency) ?? new Map()
    const k = categoryOf(category)[0]
    c.set(k, (c.get(k) ?? 0) + amount)
    m.set(currency, c)
  }
  return [...m].map(([currency, c]) => {
    const total = roundMoney([...c.values()].reduce((s, n) => s + n, 0), currency)
    const rows = [...c].map(([category, n]) => ({ category, amount: roundMoney(n, currency), ratio: total ? n / total : 0 }))
      .sort((a, b) => b.amount - a.amount)
    return { currency, total, rows }
  })
}

// 台幣在 zh-TW 會被印成「$」，跟美金分不出來，改回大家習慣的 NT$
export function fmtMoney(n, currency) {
  const d = decimalsOf(currency)
  const s = new Intl.NumberFormat('zh-TW', { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
  return currency === 'TWD' ? s.replace('$', 'NT$') : s
}
