// Mock data layer for the prototype. Shapes follow PRD §4 so it can be swapped for Supabase later.
// ponytail: whole store persisted to localStorage; bump SEED_VERSION to reseed after editing seed().
import { reactive, watch } from 'vue'

const SEED_VERSION = 1
const uid = () => Math.random().toString(36).slice(2, 10)
export const now = () => new Date().toISOString()
const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString()
const daysFromNow = d => daysAgo(-d)

export const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) : '')
export const fmtDateTime = iso => (iso ? new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
export const fmtTime = iso => (iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '')

export const COUNTRIES = [
  ['JP', '日本'], ['KR', '韓國'], ['TW', '臺灣'], ['TH', '泰國'], ['VN', '越南'], ['SG', '新加坡'], ['HK', '香港'], ['MY', '馬來西亞'],
  ['US', '美國'], ['GB', '英國'], ['FR', '法國'], ['IT', '義大利'], ['DE', '德國'], ['ES', '西班牙'], ['AU', '澳洲'], ['NZ', '紐西蘭'], ['CA', '加拿大'],
].map(([code, name]) => ({ code, name }))
export const flag = code => String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
export const countryName = code => COUNTRIES.find(c => c.code === code)?.name ?? code

// F-22: 8 fixed tag hues picked by name hash. Colour values live in style.css (.tag-0…7);
// light/dark are derived there with color-mix, so one class works in both themes.
export const tagHue = name => [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % 8
export const tagColor = name => `tag tag-${tagHue(name)}`

// 卡片上的來源標示。F-14 已經在抓 OG，真實版直接存 domain 即可。
const SOURCES = [
  [/maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps/, 'Maps'],
  [/instagram\.com/, 'IG'],
  [/tabelog\.com/, 'Tabelog'],
  [/youtube\.com|youtu\.be/, 'YouTube'],
  [/facebook\.com/, 'Facebook'],
  [/threads\.(net|com)/, 'Threads'],
  [/(^|\/\/)(www\.)?(x|twitter)\.com/, 'X'],
]
export function sourceLabel(url) {
  if (!url) return ''
  const hit = SOURCES.find(([re]) => re.test(url))
  if (hit) return hit[1]
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
// 一個項目可以有多個命名連結。沒命名就退回來源名稱，再退回網址本身。
export const MAX_LINKS = 5
export const newLink = () => ({ id: uid(), url: '', title: '' })
export const linkLabel = l => l.title?.trim() || sourceLabel(l.url) || l.url
export const firstUrl = item => item.links?.[0]?.url || ''

// ---- 深淺色：兩態。獨立於 store，重設示範資料不會被清掉。
// 沒存過（或存到舊的 ''）就用系統當下的偏好當起點，第一次打開不會跟系統相反。
export const THEMES = [['light', '淺色'], ['dark', '深色']]
const savedTheme = localStorage.getItem('pretravel-theme')
export const theme = reactive({
  v: savedTheme === 'light' || savedTheme === 'dark' ? savedTheme
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
})
watch(() => theme.v, v => {
  document.documentElement.setAttribute('data-theme', v)
  localStorage.setItem('pretravel-theme', v)
  // 手機 Chrome 的網址列底色，不跟著切的話上緣會留一條對不上的顏色
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v === 'dark' ? '#141f1e' : '#f3d9b8')
}, { immediate: true })

const pic = (seed, w = 800, h = 600) => ({ url: `https://picsum.photos/seed/${seed}/${w}/${h}`, w, h })
const avatar = u => `https://i.pravatar.cc/96?u=${u}`

function seed() {
  const item = o => {
    const b = { id: uid(), tripId: 't1', ownerUserId: 'u1', type: 'place', regionId: null, links: [], urlImage: '', images: [], note: '', visited: false, status: 'todo', plannedStore: '', tagIds: [], createdAt: daysAgo(o.age ?? 1), updatedAt: daysAgo(o.age ?? 1), ...o }
    b.createdBy ??= b.ownerUserId ?? 'u1'
    b.updatedBy = b.createdBy
    // seed 用單一 url/urlTitle 寫比較好讀，這裡轉成 links 陣列
    if (b.url) b.links = [{ id: uid(), url: b.url, title: b.urlTitle || '' }]
    delete b.url; delete b.urlTitle; delete b.age
    return b
  }
  const maps = 'https://maps.app.goo.gl/'
  return {
    v: SEED_VERSION, me: null, offline: false, pending: [], toast: null, prefs: {}, syncedAt: now(),
    users: [
      { id: 'u1', name: 'Jean', avatar: avatar('jean') },
      { id: 'u2', name: 'Ruby', avatar: avatar('ruby') },
      { id: 'u3', name: '阿凱', avatar: avatar('kai') },
      { id: 'u4', name: '小米', avatar: avatar('mi') },
    ],
    trips: [
      { id: 't1', name: '2026 秋・日本', country: 'JP', cover: pic('kyoto-autumn-street', 800, 450).url, start: '2026-11-12', end: '2026-11-19', ownerId: 'u1', deletedAt: null, updatedAt: daysAgo(0) },
      { id: 't2', name: '2025 冬・韓國', country: 'KR', cover: null, start: '2025-12-20', end: '2025-12-26', ownerId: 'u2', deletedAt: null, updatedAt: daysAgo(40) },
      { id: 't3', name: '2026 春・泰國', country: 'TH', cover: pic('bangkok-market', 800, 450).url, start: null, end: null, ownerId: 'u3', deletedAt: null, updatedAt: daysAgo(3) },
    ],
    members: [
      { tripId: 't1', userId: 'u1', role: 'owner', status: 'active', joinedAt: daysAgo(30), leftAt: null },
      { tripId: 't1', userId: 'u2', role: 'member', status: 'active', joinedAt: daysAgo(28), leftAt: null },
      { tripId: 't1', userId: 'u3', role: 'member', status: 'active', joinedAt: daysAgo(20), leftAt: null },
      { tripId: 't1', userId: 'u4', role: 'member', status: 'left', joinedAt: daysAgo(25), leftAt: daysAgo(3) },
      { tripId: 't2', userId: 'u2', role: 'owner', status: 'active', joinedAt: daysAgo(90), leftAt: null },
      { tripId: 't2', userId: 'u1', role: 'member', status: 'active', joinedAt: daysAgo(88), leftAt: null },
      { tripId: 't3', userId: 'u3', role: 'owner', status: 'active', joinedAt: daysAgo(10), leftAt: null },
      { tripId: 't3', userId: 'u2', role: 'member', status: 'active', joinedAt: daysAgo(9), leftAt: null },
    ],
    regions: [
      { id: 'r1', tripId: 't1', name: '東京', order: 0 },
      { id: 'r2', tripId: 't1', name: '大阪', order: 1 },
      { id: 'r3', tripId: 't1', name: '京都', order: 2 },
      { id: 'r4', tripId: 't2', name: '首爾', order: 0 },
      { id: 'r5', tripId: 't3', name: '曼谷', order: 0 },
    ],
    tags: [
      { id: 'g1', tripId: 't1', userId: 'u1', name: '拉麵' },
      { id: 'g2', tripId: 't1', userId: 'u1', name: '甜點' },
      { id: 'g3', tripId: 't1', userId: 'u1', name: '藥妝' },
      { id: 'g4', tripId: 't1', userId: 'u1', name: '伴手禮' },
      { id: 'g5', tripId: 't1', userId: 'u2', name: '拉麵' },
      { id: 'g6', tripId: 't1', userId: 'u2', name: '咖啡' },
      { id: 'g7', tripId: 't1', userId: 'u3', name: '必吃' },
    ],
    items: [
      // 我的・地點
      item({ title: '一蘭 新宿中央東口店', regionId: 'r1', url: maps + 'x1kr9', urlTitle: '一蘭 新宿中央東口店', urlImage: pic('ichiran-shinjuku').url, tagIds: ['g1'], note: '24 小時營業，早上人最少\n先在門口機器買食券', age: 2 }),
      item({ title: '麵屋一燈', regionId: 'r1', url: maps + 'm2tq4', urlTitle: '麵屋一燈', urlImage: pic('menya-itto').url, tagIds: ['g1'], note: '濃厚魚介沾麵，開店前 30 分鐘去排', age: 5 }),
      item({ title: 'HARBS 澀谷店', regionId: 'r1', url: 'https://www.instagram.com/p/harbs-shibuya/', urlTitle: 'HARBS 澀谷店', urlImage: pic('harbs-cake').url, tagIds: ['g2'], note: '水果千層蛋糕，季節限定的先問', age: 6 }),
      item({ title: '黑門市場', regionId: 'r2', url: maps + 'k8bn2', urlTitle: '黑門市場', urlImage: pic('kuromon-market').url, visited: true, note: '早上去，河豚跟烤扇貝', age: 9 }),
      item({ title: '伏見稻荷大社', regionId: 'r3', url: maps + 'f4sh1', urlTitle: '伏見稻荷大社', images: [pic('fushimi-inari-torii'), pic('fushimi-inari-path')], note: '走到四辻就好，來回約 1.5 小時', age: 12 }),
      item({ title: '蔦屋書店 銀座', url: maps + 't7gz3', urlTitle: 'GINZA SIX 蔦屋書店', urlImage: pic('ginza-bookstore').url, note: '藝術書區', age: 1 }),
      // 我的・購物
      item({ type: 'shopping', title: '合利他命 EX Plus 270 錠', regionId: 'r2', plannedStore: '唐吉訶德 道頓堀店', tagIds: ['g3'], images: [pic('alinamin-box', 600, 600)], note: '幫媽媽帶兩盒', age: 3 }),
      item({ type: 'shopping', title: '休足時間 18 片', regionId: 'r2', plannedStore: '松本清', tagIds: ['g3'], age: 4 }),
      item({ type: 'shopping', title: "ROYCE' 生巧克力 原味", plannedStore: '關西機場 免稅店', tagIds: ['g4'], status: 'bought', images: [pic('royce-chocolate', 600, 600)], age: 7 }),
      item({ type: 'shopping', title: '東京香蕉 8 入', regionId: 'r1', plannedStore: '東京車站', tagIds: ['g4'], status: 'not_found', note: '車站店缺貨，機場再看', age: 8 }),
      item({ type: 'shopping', title: '太田胃散 分包 32 包', regionId: 'r1', plannedStore: '松本清', tagIds: ['g3'], status: 'bought', age: 10 }),
      // 共同分頁
      item({ ownerUserId: null, createdBy: 'u2', title: '一蘭 道頓堀店', regionId: 'r2', url: maps + 'd3rm7', urlTitle: '一蘭 道頓堀店', urlImage: pic('ichiran-dotonbori').url, tagIds: ['g1', 'g5'], note: '大家一起去的那天吃', age: 4 }),
      item({ ownerUserId: null, createdBy: 'u3', title: '蟹道樂 道頓堀本店', regionId: 'r2', url: maps + 'c9kn5', urlTitle: '蟹道樂 道頓堀本店', urlImage: pic('crab-restaurant').url, tagIds: ['g7'], note: '要先訂位，阿凱負責', age: 6 }),
      item({ ownerUserId: null, createdBy: 'u3', type: 'shopping', title: 'KitKat 抹茶 大包裝 x4', regionId: 'r2', plannedStore: '唐吉訶德 道頓堀店', note: '辦公室分', age: 2 }),
      // Ruby 的分頁
      item({ ownerUserId: 'u2', title: '% Arabica 京都嵐山', regionId: 'r3', url: maps + 'a5rb8', urlTitle: '% Arabica Kyoto Arashiyama', urlImage: pic('arabica-coffee').url, tagIds: ['g6'], note: '河邊那間，早上光線好', age: 5 }),
      item({ ownerUserId: 'u2', title: '中村藤吉 本店', regionId: 'r3', url: maps + 'n1tk6', urlTitle: '中村藤吉本店', urlImage: pic('uji-matcha').url, note: '抹茶蕎麥麵、生茶果凍', age: 7 }),
      item({ ownerUserId: 'u2', type: 'shopping', title: 'SK-II 青春露 230ml', plannedStore: '機場免稅', age: 3 }),
      // 阿凱的分頁
      item({ ownerUserId: 'u3', title: '美津の 大阪燒', regionId: 'r2', url: maps + 'z6ok2', urlTitle: 'お好み焼 美津の', urlImage: pic('okonomiyaki').url, tagIds: ['g7'], age: 8 }),
      // 小米（已離開）的分頁
      item({ ownerUserId: 'u4', title: '淺草 花月堂 菠蘿麵包', regionId: 'r1', url: maps + 'h2ks9', urlTitle: '浅草花月堂', urlImage: pic('melon-pan').url, age: 15 }),
      // 韓國
      item({ tripId: 't2', title: '廣藏市場', regionId: 'r4', url: maps + 'g4jm1', urlTitle: '광장시장', urlImage: pic('gwangjang-market').url, note: '綁帶飯捲、綠豆煎餅', age: 45 }),
      item({ tripId: 't2', type: 'shopping', title: '正官庄 紅蔘精', plannedStore: '樂天免稅店', age: 44 }),
    ],
    invites: [
      { id: 'i1', tripId: 't1', token: 'k7QmZ2pW9xL4vB3n', createdBy: 'u1', expiresAt: daysFromNow(5), revokedAt: null },
      { id: 'i2', tripId: 't3', token: 'demo-thai', createdBy: 'u3', expiresAt: daysFromNow(6), revokedAt: null },
      { id: 'i3', tripId: 't3', token: 'expired-demo', createdBy: 'u3', expiresAt: daysAgo(1), revokedAt: null },
    ],
  }
}

const saved = JSON.parse(localStorage.getItem('pretravel') || 'null')
export const store = reactive(saved?.v === SEED_VERSION ? { ...saved, toast: null, offline: false, pending: [] } : seed())
// 舊資料（單一 url + urlTitle）就地升級成 links 陣列，不用重設示範資料。
store.items.forEach(i => {
  if (i.links) return
  i.links = i.url ? [{ id: uid(), url: i.url, title: i.urlTitle || '' }] : []
  delete i.url; delete i.urlTitle
})

// 圖片以 data URL 存進 localStorage，會撞到 ~5 MB 上限。塞爆時要講出來，
// 不能讓 watch 每次都 throw 然後靜默停止保存。真實版圖片在 bucket，不會有這問題。
let quotaWarned = false
watch(store, s => {
  try { localStorage.setItem('pretravel', JSON.stringify(s)) } catch {
    if (!quotaWarned) { quotaWarned = true; toast('本機空間已滿，新的變更不會被保留（原型限制）') }
  }
}, { deep: true })
export function resetDemo() { localStorage.removeItem('pretravel'); location.href = '/login' }

// ---- reads
export const me = () => store.users.find(u => u.id === store.me)
export const user = id => store.users.find(u => u.id === id)
export const trip = id => store.trips.find(t => t.id === id && !t.deletedAt)
export const tripMembers = tripId => store.members.filter(m => m.tripId === tripId)
export const isOwner = tripId => trip(tripId)?.ownerId === store.me
export const myTrips = () => store.trips
  .filter(t => !t.deletedAt && store.members.some(m => m.tripId === t.id && m.userId === store.me && m.status === 'active'))
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
export const regionsOf = tripId => store.regions.filter(r => r.tripId === tripId).sort((a, b) => a.order - b.order)
export const regionItemCount = r => store.items.filter(i => i.regionId === r.id).length
export const myTags = tripId => store.tags.filter(g => g.tripId === tripId && g.userId === store.me)
export const tagUsage = g => store.items.filter(i => i.tagIds.includes(g.id)).length
export const item = id => store.items.find(i => i.id === id)
export const prefs = tripId => (store.prefs[tripId] ??= { tab: 'me', type: 'place', region: 'all', status: '', tag: '', q: '' })
const touch = tripId => { const t = trip(tripId); if (t) t.updatedAt = now() }

// ---- toast
let toastTimer
export function toast(text, action) {
  store.toast = { text, action }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (store.toast = null), 3500)
}

// ---- auth
export function login(userId) { store.me = userId }
export function logout() { store.me = null }

// ---- images
// F-27 的前端壓縮。存 data URL 而不是 objectURL：blob: 網址重整後就失效，圖會變破圖。
// 原型把圖片塞進 localStorage，所以尺寸比 PRD 的 1600 px 保守（見 MAX）；
// 真實版改成 canvas.toBlob() 上傳 bucket，這段 canvas 邏輯可以原封不動重用。
export const MAX = { avatar: 256, cover: 1024, item: 800 }
export function shrinkImage(file, max = MAX.item) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(src)
      resolve({ url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height })
    }
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('decode')) }
    img.src = src
  })
}

// ---- profile
export function updateProfile({ name, avatar }) {
  const u = me()
  name = name.trim().slice(0, 30)
  if (!name) return false
  Object.assign(u, { name, avatar })
  return true
}

// ---- trips
export function createTrip({ name, country, start, end, cover }) {
  const id = uid(), ts = now()
  store.trips.push({ id, name: name.trim(), country, cover: cover || null, start: start || null, end: end || null, ownerId: store.me, deletedAt: null, updatedAt: ts })
  store.members.push({ tripId: id, userId: store.me, role: 'owner', status: 'active', joinedAt: ts, leftAt: null })
  return id
}
export function updateTrip(id, { name, country, start, end, cover }) {
  Object.assign(trip(id), { name: name.trim(), country, start: start || null, end: end || null, cover: cover || null, updatedAt: now() })
}
export function deleteTrip(id) { trip(id).deletedAt = now() }

// ---- regions
export function addRegion(tripId, name) {
  name = name.trim().slice(0, 30)
  if (!name) return null
  if (store.regions.some(r => r.tripId === tripId && r.name === name)) { toast('已有同名地區'); return null }
  const r = { id: uid(), tripId, name, order: regionsOf(tripId).length }
  store.regions.push(r); touch(tripId)
  return r
}
export function renameRegion(r, name) {
  name = name.trim().slice(0, 30)
  if (!name) return
  if (store.regions.some(x => x.tripId === r.tripId && x.name === name && x.id !== r.id)) return toast('已有同名地區')
  r.name = name
}
export function moveRegion(r, dir) {
  const list = regionsOf(r.tripId), i = list.indexOf(r), j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i].order, list[j].order] = [list[j].order, list[i].order]
}
export function deleteRegion(r) {
  store.items.forEach(i => { if (i.regionId === r.id) i.regionId = null })
  store.regions.splice(store.regions.indexOf(r), 1)
}

// ---- tags (F-22: per user × trip, max 50)
export function ensureTag(tripId, name) {
  name = name.trim().slice(0, 20)
  if (!name) return null
  const mine = myTags(tripId)
  const found = mine.find(g => g.name === name)
  if (found) return found
  if (mine.length >= 50) { toast('每個專案最多 50 個標籤'); return null }
  const g = { id: uid(), tripId, userId: store.me, name }
  store.tags.push(g)
  return g
}
export function renameTag(g, name) {
  name = name.trim().slice(0, 20)
  if (!name) return
  if (myTags(g.tripId).some(x => x.name === name && x.id !== g.id)) return toast('已有同名標籤')
  g.name = name
}
export function deleteTag(g) {
  store.items.forEach(i => { const k = i.tagIds.indexOf(g.id); if (k >= 0) i.tagIds.splice(k, 1) })
  store.tags.splice(store.tags.indexOf(g), 1)
}

// ---- items
export function saveItem(data) {
  const ts = now()
  if (data.id) Object.assign(item(data.id), data, { updatedAt: ts, updatedBy: store.me })
  else store.items.push({ ...data, id: uid(), createdBy: store.me, updatedBy: store.me, createdAt: ts, updatedAt: ts })
  touch(data.tripId)
}
export function deleteItem(id) { store.items.splice(store.items.findIndex(i => i.id === id), 1) }
// F-12: copy, remap tags by name to my own tags, reset status.
export function copyItem(src, target) {
  const tagIds = src.tagIds.map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean).map(n => ensureTag(src.tripId, n)?.id).filter(Boolean)
  saveItem({ ...JSON.parse(JSON.stringify(src)), id: undefined, ownerUserId: target === 'shared' ? null : store.me, tagIds, visited: false, status: 'todo' })
}
// F-19 / F-36 / F-33: optimistic status toggle, queued while offline.
export function setStatus(it, patch) {
  Object.assign(it, patch, { updatedAt: now(), updatedBy: store.me })
  if (store.offline) store.pending = store.pending.filter(p => p.id !== it.id).concat({ id: it.id, ...patch })
}
watch(() => store.offline, off => {
  if (off) return
  if (store.pending.length) { toast(`已同步 ${store.pending.length} 筆變更`); store.pending = [] }
  store.syncedAt = now()
})

// ---- invites & members
export function createInvite(tripId) {
  const i = { id: uid(), tripId, token: uid() + uid() + uid(), createdBy: store.me, expiresAt: daysFromNow(7), revokedAt: null }
  store.invites.push(i)
  return i
}
export const inviteValid = i => i && !i.revokedAt && i.expiresAt > now()
export function revokeInvite(id) { store.invites.find(i => i.id === id).revokedAt = now() }
export function acceptInvite(token) {
  const inv = store.invites.find(i => i.token === token)
  const m = store.members.find(m => m.tripId === inv.tripId && m.userId === store.me)
  if (m) Object.assign(m, { status: 'active', leftAt: null })
  else store.members.push({ tripId: inv.tripId, userId: store.me, role: 'member', status: 'active', joinedAt: now(), leftAt: null })
  return inv.tripId
}
export function removeMember(tripId, userId) {
  Object.assign(store.members.find(m => m.tripId === tripId && m.userId === userId), { status: 'left', leftAt: now() })
}
export const leaveTrip = tripId => removeMember(tripId, store.me)

// ---- F-14 / F-28 link preview (mocked; real one is a serverless function with SSRF checks)
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1|\[?fc|\[?fd|\[?fe80)/i
const CANNED = [
  { test: /maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps/, title: '一蘭 新宿中央東口店', image: pic('ichiran-shinjuku').url, description: '24 小時營業的豚骨拉麵，單人座席，可加點替玉。' },
  { test: /instagram\.com/, title: 'HARBS 澀谷店', image: pic('harbs-cake').url, description: '水果千層蛋糕是招牌，下午常需候位。' },
  { test: /tabelog\.com/, title: '麵屋一燈', image: pic('menya-itto').url, description: '濃厚魚介沾麵名店，Tabelog 3.9。' },
]
export function fetchPreview(url) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(new Error('invalid')) }
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return reject(new Error('blocked'))
    const hit = CANNED.find(c => c.test.test(url))
    setTimeout(() => resolve(hit
      ? { title: hit.title, image: hit.image, description: hit.description }
      : { title: u.hostname.replace(/^www\./, ''), image: pic(encodeURIComponent(u.hostname)).url, description: '' }), 900)
  })
}
