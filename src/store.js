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
const empty = () => ({ users: [], trips: [], members: [], regions: [], tags: [], items: [], invites: [] })
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
export const prefs = tripId => (store.prefs[tripId] ??= { tab: 'me', type: 'place', region: 'all', status: '', tag: '', q: '' })
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
  push(() => api.deleteItem(id), () => store.items.splice(i, 0, removed))
}

// F-12: copy, remap tags by name to my own tags, reset status.
export function copyItem(src, target) {
  const tagIds = src.tagIds
    .map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean)
    .map(n => ensureTag(src.tripId, n)?.id).filter(Boolean)
  const clone = JSON.parse(JSON.stringify(src))
  delete clone.id
  return saveItem({ ...clone, ownerUserId: target === 'shared' ? null : store.me, tagIds, visited: false, status: 'todo' })
}

// F-19 / F-36 / F-33: optimistic status toggle, queued while offline.
export function setStatus(it, patch) {
  const before = { visited: it.visited, status: it.status }
  Object.assign(it, patch, { updatedAt: now(), updatedBy: store.me })
  if (store.offline) {
    store.pending = store.pending.filter(p => p.id !== it.id).concat({ id: it.id, ...patch })
    return
  }
  push(() => api.patchItem(it.id, patch), () => Object.assign(it, before))
}

// 回到線上：把離線期間累積的狀態切換依序送出
watch(() => store.offline, async off => {
  if (off || !store.pending.length) { if (!off) store.syncedAt = now(); return }
  const queue = store.pending.slice()
  store.pending = []
  let failed = 0
  for (const p of queue) {
    try { await api.patchItem(p.id, p) } catch { failed++ }
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

// ---- F-14 / F-28 連結預覽。真的抓網頁的邏輯在 api/preview.js（Vercel function）。
export async function fetchPreview(url) {
  const res = await fetch('/api/preview?url=' + encodeURIComponent(url))
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error === 'blocked' ? 'blocked' : 'unreachable')
  }
  return res.json()
}
