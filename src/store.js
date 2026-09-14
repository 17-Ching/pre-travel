// 畫面的資料來源。store 是 Supabase 的本地鏡像：
// 讀取一律同步（頁面直接讀 store），寫入一律樂觀 —— 先改本地讓畫面立刻反應，
// 再把同一筆送上伺服器，失敗就回捲並跳提示。
// 這也是 PRD F-19 / F-33 要的行為，離線佇列之後接在同一個位置。
import { reactive, watch } from 'vue'
import * as api from './api'
import { sb, isConfigured, signIn as authSignIn, signUp as authSignUp, signOut as authSignOut } from './supabase'

const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()

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

// 卡片上的來源標示
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

// ---- 深淺色：兩態，跟登入無關，所以留在 localStorage
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

// ---- store 本體
const empty = () => ({ users: [], trips: [], members: [], regions: [], tags: [], items: [], invites: [], entries: [], days: [] })
export const store = reactive({
  me: null,          // 目前登入者的 id
  ready: false,      // 第一次載入完成前，頁面顯示載入中
  loading: false,
  offline: false,
  pending: [],
  toast: null,
  syncedAt: now(),
  // 篩選條件記在本機，切換分頁不重設（F-24）
  prefs: JSON.parse(localStorage.getItem('pretravel-prefs') || '{}'),
  ...empty(),
})
watch(() => store.prefs, p => localStorage.setItem('pretravel-prefs', JSON.stringify(p)), { deep: true })

// ---- toast
let toastTimer
export function toast(text, action) {
  store.toast = { text, action }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (store.toast = null), 3500)
}

// 樂觀寫入的共用外殼：本地已經改好了，這裡只負責送出與善後。
// 失敗時跑 rollback 並把訊息講出來，不能靜默丟失（PRD §7 錯誤處理）。
//
// 全部寫入排成一條序列，不是為了節流，是因為後寫的可能引用先寫的：
// 使用者在新增項目時順手建了地區，本地兩筆立刻就有了，但送到伺服器如果亂序，
// 項目會因為地區還不存在而踩到外鍵錯誤。實測就是這樣掛的。
// 所以這裡收的是「還沒發動的函式」，輪到它才真的送出。
let chain = Promise.resolve()
function push(makeRequest, rollback) {
  chain = chain.then(makeRequest).catch(err => {
    rollback?.()
    toast(err.message || '儲存失敗，請再試一次')
  })
  return chain
}

// ---- reads（全部同步，頁面不用改）
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
// F-09：v2.0 起預設落點是行程，不是自己的清單分頁
export const prefs = tripId => (store.prefs[tripId] ??= { tab: 'itinerary', type: 'place', region: 'all', status: '', tag: '', q: '' })
const touch = tripId => { const t = trip(tripId); if (t) t.updatedAt = now() }

// ---- 載入
// 圖片存的是 bucket 路徑，畫面要的是簽名網址。一次簽一批補上 url 欄位。
async function attachImageUrls() {
  const paths = [
    ...store.trips.map(t => t.coverPath),
    ...store.items.flatMap(i => i.images.map(im => im.path)),
  ]
  const signed = await api.signPaths(paths)
  for (const t of store.trips) t.cover = signed.get(t.coverPath) || ''
  for (const i of store.items) for (const im of i.images) im.url = signed.get(im.path) || ''
}

export async function refresh() {
  if (!store.me) return
  store.loading = true
  try {
    Object.assign(store, await api.loadAll())
    await attachImageUrls()
    store.syncedAt = now()
  } catch (err) {
    toast(err.message)
  } finally {
    store.loading = false
    store.ready = true
  }
}

// ---- auth
const currentUserId = async () => (await sb().auth.getSession()).data.session?.user?.id ?? null

export async function bootstrap() {
  // 沒設定環境變數時不要炸掉整個 app，讓畫面正常走到登入頁再講
  if (!isConfigured) { store.ready = true; return }
  try { store.me = await currentUserId() } catch { store.me = null }
  if (store.me) await refresh()
  else store.ready = true
}

export async function signUp(username, password, displayName) {
  const { error } = await authSignUp(username, password, displayName)
  if (error) return { error }
  store.me = await currentUserId()
  if (!store.me) return { error: '註冊成功但沒有拿到登入狀態，請改用登入' }
  await refresh()
  return { error: null }
}

export async function signIn(username, password) {
  const { error } = await authSignIn(username, password)
  if (error) return { error }
  store.me = await currentUserId()
  await refresh()
  return { error: null }
}

export async function logout() {
  await authSignOut()
  store.me = null
  store.ready = true
  Object.assign(store, empty())
}

// ---- images
// F-27 的前端壓縮。canvas 縮完轉成 Blob 上傳 bucket，資料庫只存路徑。
export const MAX = { avatar: 256, cover: 1024, item: 1600 }
function drawScaled(file, max) {
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
      c.toBlob(b => (b ? resolve({ blob: b, w: c.width, h: c.height }) : reject(new Error('encode'))), 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('decode')) }
    img.src = src
  })
}

// 回傳 { path, url, w, h }：path 進資料庫，url 給畫面立刻顯示
export async function uploadItemImage(tripId, file, max = MAX.item) {
  const { blob, w, h } = await drawScaled(file, max)
  const path = await api.uploadImage(tripId, blob)
  const signed = await api.signPaths([path])
  return { path, url: signed.get(path) || URL.createObjectURL(blob), w, h }
}

// F-14 / F-28：連結預覽圖與貼上的圖片網址都要轉存成自己的副本，
// 因為 IG 和 Google 的圖片網址會過期，而且離線時要有本地檔。
// 後端已經把圖抓成 data URL 送回來（瀏覽器直接抓跨網域圖片會污染 canvas）。
export async function uploadImageFromDataUrl(tripId, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob()
  return uploadItemImage(tripId, blob)
}

// ---- profile
export async function updateProfile({ name, avatarFile, avatar }) {
  name = (name ?? '').trim().slice(0, 30)
  if (!name) return false
  try {
    let avatarUrl = avatar ?? me()?.avatar ?? null
    if (avatarFile) {
      const { blob } = await drawScaled(avatarFile, MAX.avatar)
      avatarUrl = await api.uploadAvatar(store.me, blob)
    }
    const saved = await api.saveProfile(store.me, { name, avatar: avatarUrl })
    Object.assign(me(), saved)
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

// ---- trips
// 這一支是非同步的：id 由 create_trip 在伺服器端產生，畫面要拿它導頁
export async function createTrip({ name, country, start, end, coverFile }) {
  try {
    let coverPath = null
    if (coverFile) {
      const { blob } = await drawScaled(coverFile, MAX.cover)
      // 封面要先有 trip id 才知道放哪個資料夾，所以先建專案、再補封面
      const id = await api.createTrip({ name, country, start, end, coverPath: null })
      await refresh()
      coverPath = await api.uploadImage(id, blob)
      await api.updateTrip(id, { name, country, start, end, coverPath })
      await refresh()
      return id
    }
    coverPath = null
    const id = await api.createTrip({ name, country, start, end, coverPath })
    await refresh()
    return id
  } catch (err) {
    toast(err.message)
    return null
  }
}

export async function updateTrip(id, { name, country, start, end, coverFile, cover }) {
  const t = trip(id)
  if (!t) return
  try {
    let coverPath = t.coverPath
    if (coverFile) {
      const { blob } = await drawScaled(coverFile, MAX.cover)
      coverPath = await api.uploadImage(id, blob)
    } else if (cover === null) {
      coverPath = null
    }
    const saved = await api.updateTrip(id, { name, country, start, end, coverPath })
    Object.assign(t, saved)
    await attachImageUrls()
  } catch (err) {
    toast(err.message)
  }
}

export function deleteTrip(id) {
  const t = trip(id)
  if (!t) return
  const before = t.deletedAt
  t.deletedAt = now()
  return push(() => api.deleteTrip(id), () => { t.deletedAt = before })
}

// ---- regions
export function addRegion(tripId, name) {
  name = name.trim().slice(0, 30)
  if (!name) return null
  if (store.regions.some(r => r.tripId === tripId && r.name === name)) { toast('已有同名地區'); return null }
  const r = reactive({ id: uid(), tripId, name, order: regionsOf(tripId).length })
  store.regions.push(r)
  touch(tripId)
  push(() => api.addRegion(tripId, name, r.order, r.id), () => {
    const i = store.regions.indexOf(r)
    if (i >= 0) store.regions.splice(i, 1)
  })
  return r
}
export function renameRegion(r, name) {
  name = name.trim().slice(0, 30)
  if (!name || name === r.name) return
  if (store.regions.some(x => x.tripId === r.tripId && x.name === name && x.id !== r.id)) return toast('已有同名地區')
  const before = r.name
  r.name = name
  push(() => api.renameRegion(r.id, name), () => { r.name = before })
}
export function moveRegion(r, dir) {
  const list = regionsOf(r.tripId), i = list.indexOf(r), j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i].order, list[j].order] = [list[j].order, list[i].order]
  push(() => api.setRegionOrder([[list[i].id, list[i].order], [list[j].id, list[j].order]]), () => {
    ;[list[i].order, list[j].order] = [list[j].order, list[i].order]
  })
}
export function deleteRegion(r) {
  const i = store.regions.indexOf(r)
  const affected = store.items.filter(x => x.regionId === r.id)
  affected.forEach(x => { x.regionId = null })
  store.regions.splice(i, 1)
  push(() => api.deleteRegion(r.id), () => {
    store.regions.splice(i, 0, r)
    affected.forEach(x => { x.regionId = r.id })
  })
}

// ---- tags (F-22: per user × trip, max 50)
export function ensureTag(tripId, name) {
  name = name.trim().slice(0, 20)
  if (!name) return null
  const mine = myTags(tripId)
  const found = mine.find(g => g.name === name)
  if (found) return found
  if (mine.length >= 50) { toast('每個專案最多 50 個標籤'); return null }
  const g = reactive({ id: uid(), tripId, userId: store.me, name })
  store.tags.push(g)
  push(() => api.addTag(tripId, store.me, name, g.id), () => {
    const i = store.tags.indexOf(g)
    if (i >= 0) store.tags.splice(i, 1)
  })
  return g
}
export function renameTag(g, name) {
  name = name.trim().slice(0, 20)
  if (!name || name === g.name) return
  if (myTags(g.tripId).some(x => x.name === name && x.id !== g.id)) return toast('已有同名標籤')
  const before = g.name
  g.name = name
  push(() => api.renameTag(g.id, name), () => { g.name = before })
}
export function deleteTag(g) {
  const i = store.tags.indexOf(g)
  const tagged = store.items.filter(x => x.tagIds.includes(g.id))
  tagged.forEach(x => x.tagIds.splice(x.tagIds.indexOf(g.id), 1))
  store.tags.splice(i, 1)
  push(() => api.deleteTag(g.id), () => {
    store.tags.splice(i, 0, g)
    tagged.forEach(x => x.tagIds.push(g.id))
  })
}

// ---- items
export function saveItem(data) {
  const existing = data.id ? item(data.id) : null
  if (existing) {
    const before = JSON.parse(JSON.stringify(existing))
    Object.assign(existing, data, { updatedAt: now(), updatedBy: store.me })
    touch(data.tripId)
    push(() => api.updateItem(existing, before.tagIds), () => Object.assign(existing, before))
    return existing
  }
  const it = reactive({
    regionId: null, links: [], images: [], note: '', visited: false,
    status: 'todo', plannedStore: '', tagIds: [],
    ...data,
    id: data.id ?? uid(),
    createdBy: store.me, updatedBy: store.me, createdAt: now(), updatedAt: now(),
  })
  store.items.push(it)
  touch(data.tripId)
  push(() => api.createItem(it, store.me), () => {
    const i = store.items.indexOf(it)
    if (i >= 0) store.items.splice(i, 1)
  })
  return it
}

export function deleteItem(id) {
  const i = store.items.findIndex(x => x.id === id)
  if (i < 0) return
  const [removed] = store.items.splice(i, 1)
  // F-47：資料庫的觸發器會把引用它的行程項目斷開並留下標題快照。
  // 這裡做同一件事，畫面才不用等重新整理就正確。
  const refs = store.entries.filter(e => e.itemId === id)
  const snapshot = refs.map(e => ({ e, itemId: e.itemId, title: e.title, detachedAt: e.detachedAt }))
  refs.forEach(e => {
    e.itemId = null
    e.title = e.title?.trim() || removed.title
    e.detachedAt = now()
  })
  push(() => api.deleteItem(id), () => {
    store.items.splice(i, 0, removed)
    snapshot.forEach(s => Object.assign(s.e, { itemId: s.itemId, title: s.title, detachedAt: s.detachedAt }))
  })
}

// F-12：複製他人項目到自己的分頁，標籤依名稱對應到自己的標籤，狀態重設。
// v2.0 共同分頁移除（Q8），複製目標只剩「我的分頁」，所以不再收 target。
export function copyItem(src) {
  const tagIds = src.tagIds
    .map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean)
    .map(n => ensureTag(src.tripId, n)?.id).filter(Boolean)
  const clone = JSON.parse(JSON.stringify(src))
  delete clone.id
  return saveItem({ ...clone, ownerUserId: store.me, tagIds, visited: false, status: 'todo' })
}

// F-19 / F-36 / F-33: optimistic status toggle, queued while offline.
export function setStatus(it, patch) {
  const before = { visited: it.visited, status: it.status }
  Object.assign(it, patch, { updatedAt: now(), updatedBy: store.me })
  if (store.offline) {
    store.pending = store.pending.filter(p => !(p.kind === 'item' && p.id === it.id))
      .concat({ kind: 'item', id: it.id, ...patch })
    return
  }
  push(() => api.patchItem(it.id, patch), () => Object.assign(it, before))
}

// 回到線上：把離線期間累積的狀態切換依序送出。
// 佇列裡兩種東西：清單項目的購買/已去過，以及行程項目的完成。
watch(() => store.offline, async off => {
  if (off || !store.pending.length) { if (!off) store.syncedAt = now(); return }
  const queue = store.pending.slice()
  store.pending = []
  let failed = 0
  for (const p of queue) {
    try {
      if (p.kind === 'entry') await api.updateEntry(p.id, { done: p.done })
      else await api.patchItem(p.id, p)
    } catch { failed++ }
  }
  toast(failed ? `同步完成，${failed} 筆失敗（項目可能已被刪除）` : `已同步 ${queue.length} 筆變更`)
  store.syncedAt = now()
  if (failed) refresh()
})

// ---- invites & members
export function createInvite(tripId) {
  const token = (uid() + uid()).replaceAll('-', '')
  const inv = reactive({
    id: uid(), tripId, token, createdBy: store.me,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), revokedAt: null,
  })
  store.invites.push(inv)
  push(() => api.createInvite(tripId, store.me, inv.id, token), () => {
    const i = store.invites.indexOf(inv)
    if (i >= 0) store.invites.splice(i, 1)
  })
  return inv
}
export const inviteValid = i => i && !i.revokedAt && i.expiresAt > now()
export function revokeInvite(id) {
  const inv = store.invites.find(i => i.id === id)
  if (!inv) return
  inv.revokedAt = now()
  push(() => api.revokeInvite(id), () => { inv.revokedAt = null })
}
export const invitePreview = api.invitePreview

export async function acceptInvite(token) {
  try {
    const tripId = await api.acceptInvite(token)
    await refresh()
    return tripId
  } catch (err) {
    toast(err.message)
    return null
  }
}

export function removeMember(tripId, userId) {
  const m = store.members.find(x => x.tripId === tripId && x.userId === userId)
  if (!m) return
  const before = { status: m.status, leftAt: m.leftAt }
  Object.assign(m, { status: 'left', leftAt: now() })
  push(() => api.setMemberStatus(tripId, userId, 'left'), () => Object.assign(m, before))
}
export const leaveTrip = tripId => removeMember(tripId, store.me)

// ---- 行程（F-37 到 F-47）----
// 日期一律用 'YYYY-MM-DD' 字串處理。不要用 new Date('2026-11-12')，
// 那會被當成 UTC 午夜解析，在 UTC+8 算出來就是前一天。D8 說不做時區換算，
// 這裡的做法就是從頭到尾不讓 Date 碰到日期的語意。
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const isoOf = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
export const todayISO = () => isoOf(new Date())
export const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoOf(d) }

// F-37 的日期列 + F-46 的範圍外日子。元件直接拿這個畫，不用自己算日期。
export function tripDays(tripId) {
  const t = trip(tripId)
  if (!t?.start || !t?.end) return []
  const today = todayISO()
  const days = []
  for (let iso = t.start, n = 1; iso <= t.end; iso = addDays(iso, 1), n++) {
    days.push({ date: iso, dayNo: n, weekday: WEEK[parseDate(iso).getDay()], isToday: iso === today, outOfRange: false })
  }
  // F-46：縮短日期不刪資料。落在範圍外又有內容的日子排在最後面，用警示色提示搬走。
  const inRange = new Set(days.map(d => d.date))
  const stray = [...new Set([
    ...store.entries.filter(e => e.tripId === tripId).map(e => e.date),
    ...store.days.filter(d => d.tripId === tripId && d.note.trim()).map(d => d.date),
  ])].filter(d => !inRange.has(d)).sort()
  for (const iso of stray) {
    days.push({ date: iso, dayNo: null, weekday: WEEK[parseDate(iso).getDay()], isToday: iso === today, outOfRange: true })
  }
  return days
}

// F-40：有時間的排前面依時間，沒時間的排後面依手動排序。
// 這規則在行程三個時段加餐食五個餐別共八個地方都要用，放在元件裡等於複製八份。
const byTimeThenOrder = (a, b) => {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime) || a.order - b.order
  if (a.startTime) return -1
  if (b.startTime) return 1
  return a.order - b.order
}
export const entriesOf = (tripId, date, section, slot) => store.entries
  .filter(e => e.tripId === tripId && e.date === date && e.section === section && e.slot === slot)
  .sort(byTimeThenOrder)

export function daySummary(tripId, date) {
  const list = store.entries.filter(e => e.tripId === tripId && e.date === date)
  return {
    schedule: list.filter(e => e.section === 'schedule').length,
    meal: list.filter(e => e.section === 'meal').length,
    done: list.filter(e => e.done).length,
  }
}

export const dayNote = (tripId, date) =>
  store.days.find(d => d.tripId === tripId && d.date === date)?.note ?? ''

// 引用的是活的資料（Q10）：被引用項目改標題或換照片，行程跟著變。
// F-47 斷開引用後 title 變成快照，這兩支負責把判斷收在一個地方。
export const entryTitle = e => (e.itemId ? item(e.itemId)?.title || e.title : e.title)
export const entryThumb = e => (e.itemId ? item(e.itemId)?.images?.[0]?.url || '' : '')
// 「使用者自己打的」和「引用被刪掉後斷開的」資料長得一模一樣，
// item_id 都是 null、title 都有值，所以必須靠資料庫留下的記號來分，
// 前端推不出來。detached_at 由 F-47 的觸發器寫入。
export const entryDetached = e => Boolean(e.detachedAt)

// F-41 的重複提示與 F-15 的「已排入行程」徽章共用這一支
export const scheduledSlots = itemId => store.entries
  .filter(e => e.itemId === itemId)
  .map(({ date, section, slot }) => ({ date, section, slot }))

const nextOrder = (tripId, date, section, slot) =>
  entriesOf(tripId, date, section, slot).reduce((m, e) => Math.max(m, e.order + 1), 0)

function buildEntry(d, order) {
  return reactive({
    id: uid(),
    tripId: d.tripId, date: d.date, section: d.section, slot: d.slot,
    kind: d.kind ?? 'place',
    itemId: d.itemId ?? null,
    title: (d.title ?? '').trim(),
    transportMode: d.transportMode ?? '',
    startTime: d.startTime ?? '', endTime: d.endTime ?? '',
    note: d.note ?? '', done: false, order,
    detachedAt: null,
    createdBy: store.me, updatedBy: store.me,
    createdAt: now(), updatedAt: now(),
  })
}

export function addEntry(data) {
  return addEntries([data])[0]
}

// F-41 一次加入多筆。傳進來的順序就是 sort_order 的順序。
// 一次送出，不拆成多次往返，中途失敗才不會留下加了一半的行程。
export function addEntries(list) {
  if (!list.length) return []
  const counters = new Map()
  const built = list.map(d => {
    const key = `${d.date}|${d.section}|${d.slot}`
    const base = counters.get(key) ?? nextOrder(d.tripId, d.date, d.section, d.slot)
    counters.set(key, base + 1)
    return buildEntry(d, base)
  })
  store.entries.push(...built)
  touch(list[0].tripId)
  push(() => api.createEntries(built, store.me), () => {
    for (const e of built) {
      const i = store.entries.indexOf(e)
      if (i >= 0) store.entries.splice(i, 1)
    }
  })
  return built
}

export function updateEntry(entry, patch) {
  const before = { ...entry }
  Object.assign(entry, patch, { updatedAt: now(), updatedBy: store.me })
  push(() => api.updateEntry(entry.id, patch), () => Object.assign(entry, before))
}

// D1：勾完成時，若引用的是自己的地點就同步 visited。
// 真正的寫入由資料庫觸發器做（換裝置、別人操作時也要成立），
// 這裡只是把同一件事反映在本地，畫面才不用等重新整理。
export function toggleEntryDone(entry) {
  const done = !entry.done
  const before = entry.done
  entry.done = done
  entry.updatedAt = now()
  entry.updatedBy = store.me

  const ref = entry.itemId ? item(entry.itemId) : null
  const mirrors = Boolean(ref && ref.ownerUserId === store.me && ref.type === 'place')
  const visitedBefore = ref?.visited
  if (mirrors) ref.visited = done

  if (store.offline) {
    store.pending = store.pending.filter(p => !(p.kind === 'entry' && p.id === entry.id))
      .concat({ kind: 'entry', id: entry.id, done })
    return
  }
  push(() => api.updateEntry(entry.id, { done }), () => {
    entry.done = before
    if (mirrors) ref.visited = visitedBefore
  })
}

export function reorderEntries(tripId, date, section, slot, orderedIds) {
  const before = new Map()
  const pairs = []
  orderedIds.forEach((id, i) => {
    const e = store.entries.find(x => x.id === id)
    if (!e) return
    before.set(e, e.order)
    e.order = i
    pairs.push([id, i])
  })
  push(() => api.setEntryOrder(pairs), () => before.forEach((v, e) => { e.order = v }))
}

// 跨日拖曳 v1 不做，改走卡片選單的「搬到其他天」，都是同一支
export function moveEntry(entry, target) {
  const before = { date: entry.date, section: entry.section, slot: entry.slot, order: entry.order }
  const order = nextOrder(entry.tripId, target.date, target.section, target.slot)
  Object.assign(entry, target, { order, updatedAt: now(), updatedBy: store.me })
  push(() => api.updateEntry(entry.id, { ...target, order }), () => Object.assign(entry, before))
}

export function deleteEntry(id) {
  const i = store.entries.findIndex(e => e.id === id)
  if (i < 0) return
  const [removed] = store.entries.splice(i, 1)
  push(() => api.deleteEntry(id), () => store.entries.splice(i, 0, removed))
}

// F-43：空備註不留資料列，清空等於刪掉那一筆
export function setDayNote(tripId, date, note) {
  note = (note ?? '').slice(0, 500)
  const existing = store.days.find(d => d.tripId === tripId && d.date === date)
  const before = existing ? { ...existing } : null

  if (!note.trim()) {
    if (!existing) return
    store.days.splice(store.days.indexOf(existing), 1)
    push(() => api.deleteDayNote(tripId, date), () => store.days.push(reactive(before)))
    return
  }
  if (existing) {
    Object.assign(existing, { note, updatedBy: store.me, updatedAt: now() })
    push(() => api.saveDayNote(tripId, date, note, store.me), () => Object.assign(existing, before))
    return
  }
  const created = reactive({ tripId, date, note, updatedBy: store.me, updatedAt: now() })
  store.days.push(created)
  push(() => api.saveDayNote(tripId, date, note, store.me), () => {
    const i = store.days.indexOf(created)
    if (i >= 0) store.days.splice(i, 1)
  })
}

// ---- F-14 / F-28 連結預覽。真的抓網頁的邏輯在 api/preview.js（Vercel function）。
export async function fetchPreview(url) {
  const res = await fetch('/api/preview?url=' + encodeURIComponent(url))
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error === 'blocked' ? 'blocked' : 'unreachable')
  }
  return res.json()
}
