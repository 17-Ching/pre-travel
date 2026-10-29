// 畫面的資料來源。store 是 Supabase 的本地鏡像：
// 讀取一律同步（頁面直接讀 store），寫入一律樂觀 —— 先改本地讓畫面立刻反應，
// 再把同一筆送上伺服器，失敗就回捲並跳提示。
// 這也是 PRD F-19 / F-33 要的行為，離線佇列之後接在同一個位置。
import { reactive, watch } from 'vue'
import * as api from './api'
import { WEEK, parseDate, todayISO, addDays, coversDate, tripPast } from './date-rules'
import { imagePaths, unusedPaths } from './image-rules'
import { getSnapshot, setSnapshot, delSnapshot } from './offline-cache'
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
// 記帳的預設幣別跟著專案國家走，表單裡另外給一個台幣可選
const CURRENCY = { JP: 'JPY', KR: 'KRW', TW: 'TWD', TH: 'THB', VN: 'VND', SG: 'SGD', HK: 'HKD', MY: 'MYR',
  US: 'USD', GB: 'GBP', FR: 'EUR', IT: 'EUR', DE: 'EUR', ES: 'EUR', AU: 'AUD', NZ: 'NZD', CA: 'CAD' }
export const tripCurrencies = tripId => [...new Set([CURRENCY[trip(tripId)?.country] ?? 'TWD', 'TWD'])]

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
// 小格子（列表卡片 88px、行程卡片 44px、編輯表單 80px）一律吃 400px 的縮圖，
// 不要掛 1600px 的原圖。縮圖是後來才加的，舊資料沒有 thumbUrl 就退回原圖，
// 不能讓它變破圖。三個地方共用這一支，免得之後新增一個縮圖位置又忘了退路。
export const thumbOf = im => im?.thumbUrl || im?.url || ''

// 圖片載不到時頂上的插畫。打包在 public/ 才有意義 —— 備援圖要是得走同一條壞掉的
// 網路才拿得到，等於沒有備援。key 直接對上項目的 type，畫面不用再寫一次三元判斷。
// 這幾張本身也可能沒被放進去（換人 deploy、檔名打錯），所以用它的地方還要再退
// 一階到 Phosphor 圖示，跟 Login.vue 的插畫同一套做法。
export const ART = { place: '/location.png', shopping: '/shop.png', trip: '/trip.png' }

export const MAX_LINKS = 5
export const newLink = () => ({ id: uid(), url: '', title: '' })
export const linkLabel = l => l.title?.trim() || sourceLabel(l.url) || l.url
export const firstUrl = item => item.links?.[0]?.url || ''
// F-30：備註是純文字，裡面的網址變成可以點的連結。先跳脫再轉，給 v-html 用。
// 清單詳情與行程（每日備註、行程項目的備註）共用。
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener" class="break-all text-accent underline">${u}</a>`)

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
const empty = () => ({ users: [], trips: [], members: [], regions: [], tags: [], items: [], invites: [], entries: [], days: [], expenses: [] })
export const store = reactive({
  me: null,          // 目前登入者的 id
  ready: false,      // 第一次載入完成前，頁面顯示載入中
  loading: false,
  loadError: '',     // 載入失敗的訊息。空字串 = 沒失敗，畫面要靠它區分「載入失敗」與「真的沒資料」
  // 真的網路狀態（F-32）。以前是「模擬離線」的手動開關，現在跟著瀏覽器的 online / offline 事件走
  offline: !navigator.onLine,
  pending: [],
  toast: null,
  syncedAt: now(),
  // 篩選條件記在本機，切換分頁不重設（F-24）
  prefs: JSON.parse(localStorage.getItem('pretravel-prefs') || '{}'),
  ...empty(),
})
watch(() => store.prefs, p => localStorage.setItem('pretravel-prefs', JSON.stringify(p)), { deep: true })

// ---- 加入主畫面（PWA 安裝）
// Chrome / Edge 在符合安裝條件時丟 beforeinstallprompt。它在載入後不久就觸發一次，
// 所以要在 app 啟動時接住 —— 等使用者走到個人資料頁才掛 listener 早就錯過了。
// 事件物件本身就是「瀏覽器願意裝」的憑證，沒接到就不該顯示按鈕（可能是已經裝了、
// 條件不符、或這個瀏覽器根本不支援），不要自己猜。
export const install = reactive({ event: null, done: false })

// iOS Safari 沒有 beforeinstallprompt，也沒有任何可以叫出安裝的 API，只能教使用者
// 自己從分享選單加。iPadOS 的 UA 會自稱 Macintosh，所以要再看有沒有觸控點才分得出來。
export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// 已經是從主畫面開的就不用再問。標準是 display-mode，navigator.standalone 是 iOS 專有的
install.done = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
addEventListener('beforeinstallprompt', e => {
  e.preventDefault()   // 不擋的話 Chrome 會自己跳一個迷你提示，我們要自己決定何時問
  install.event = e
})
addEventListener('appinstalled', () => { install.event = null; install.done = true })

export async function promptInstall() {
  const e = install.event
  if (!e) return
  // 一個 beforeinstallprompt 只能 prompt() 一次，用過就作廢；先清掉，按鈕才不會
  // 停在那裡讓人按第二次卻沒反應。使用者按了取消的話，要等瀏覽器下次再丟事件。
  install.event = null
  await e.prompt()
}

// ---- 願望清單分組的收合狀態
// 預設全部打開（v2.5.1 使用者要的：一點進去就看到全部），所以記的是「收起了哪些」——
// 新冒出來的組自然是開著的。
// 刻意不存 localStorage：重開 app 一律從全開開始；但留在記憶體裡，點進項目詳情再
// 返回時，剛剛收起的那幾組還收著（scrollBehavior 還原的捲動位置也才有意義）。
// key 是 行程:子清單:組，組是地區 id 或標籤名，改名或刪掉只會留下用不到的舊 key，無害。
export const closedGroups = reactive(new Set())

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
// 依出發日排，早的在前，「即將到來」因此是快到的在最前面。
// 分區由 tripPast 做（Trips.vue），「過去」那一區在那裡另外照結束日反排。
// 以前是照 updatedAt 排，結果是改一個字那趟就跳到最上面，順序跟旅程本身無關，
// 要找某一趟得重新掃一遍整個列表。
// 沒有出發日的（v2.0 之前的舊資料）排到最後，不要因為空字串最小就霸佔第一個。
export const myTrips = () => store.trips
  .filter(t => !t.deletedAt && store.members.some(m => m.tripId === t.id && m.userId === store.me && m.status === 'active'))
  .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'))
export const regionsOf = tripId => store.regions.filter(r => r.tripId === tripId).sort((a, b) => a.order - b.order)
export const regionItemCount = r => store.items.filter(i => i.regionId === r.id).length
// 標籤分兩池：地點與購物共用一池（'default'），參考自己一池（'reference'）。
// 參考的分類是「轉場影片」「拍食物」這種，跟景點的「拉麵」「必去」不是同一回事，
// 混在一起兩邊的選單都會塞滿用不到的選項。同名標籤在兩池各自獨立。
export const tagScope = type => (type === 'reference' ? 'reference' : 'default')
// 有「已買 / 未買 / 沒買到」的子清單。送禮清單跟購物同一套欄位與狀態，只是只有本人看得到（RLS 擋）
export const isBuy = type => type === 'shopping' || type === 'gift'
export const myTags = (tripId, scope = 'default') =>
  store.tags.filter(g => g.tripId === tripId && g.userId === store.me && g.scope === scope)
export const tagUsage = g => store.items.filter(i => i.tagIds.includes(g.id)).length
export const item = id => store.items.find(i => i.id === id)
// F-09：分頁只有願望清單／行程兩個，看誰的清單是清單裡的第二層（who）
//
// 逐個欄位補預設而不是整包 ??=：prefs 是存在 localStorage 的，舊版存檔少的是「某幾個
// 欄位」而不是整筆，整包補的話既有使用者永遠拿不到新欄位。
export function prefs(tripId) {
  const p = (store.prefs[tripId] ??= {})
  p.tab ??= 'list'
  p.who ??= 'me'
  p.type ??= 'place'
  p.status ??= ''
  p.q ??= ''
  // 地區與標籤改成複選。舊存檔是單選字串（region 是 'all' | id | 'none'，tag 是 '' | 名稱），
  // 不轉的話 includes() 會拿字串當陣列用，篩選整個壞掉。空陣列 = 不篩。
  if (!Array.isArray(p.regions)) p.regions = p.region && p.region !== 'all' ? [p.region] : []
  if (!Array.isArray(p.tags)) p.tags = p.tag ? [p.tag] : []
  delete p.region
  delete p.tag
  return p
}
const touch = tripId => { const t = trip(tripId); if (t) t.updatedAt = now() }

// ---- 載入
// 掛著圖片的東西：清單項目、行程項目、每日備註裡的每一組連結（標題＋連結＋圖片）。
// 簽名網址與孤兒檔判斷都從這裡拿，新增放圖的地方記得加進來。
const imageHolders = () => [...store.items, ...store.entries, ...store.days.flatMap(d => d.links ?? [])]
// 航班與住宿的 PDF 附件。跟圖片同一個 bucket，孤兒檔判斷要一起算
const entryFiles = () => store.entries.flatMap(e => e.files ?? [])
// 圖片存的是 bucket 路徑，畫面要的是簽名網址。一次簽一批補上 url 欄位。
async function attachImageUrls() {
  const paths = [
    ...store.trips.map(t => t.coverPath),
    ...imageHolders().flatMap(i => (i.images ?? []).flatMap(im => [im.path, im.thumbPath])),
    ...entryFiles().map(f => f.path),
  ]
  const signed = await api.signPaths(paths)
  // 簽不出來（沒網路、storage 掛掉）就原封不動離開。signPaths 失敗是回空 Map 不是丟錯，
  // 照著寫下去等於把每一張的網址清成空字串，一次暫時的失敗就讓所有圖片消失到下次
  // 重新整理為止。留著舊網址至少有機會還是好的，真的過期了畫面也有佔位圖接手。
  if (!signed.size && paths.some(Boolean)) return
  for (const t of store.trips) t.cover = signed.get(t.coverPath) || ''
  for (const f of entryFiles()) f.url = signed.get(f.path) || ''
  for (const i of imageHolders()) for (const im of i.images ?? []) {
    im.url = signed.get(im.path) || ''
    // 縮圖是後來才加的，舊資料沒有 thumbPath，這裡就是空字串，畫面那邊要退回 url
    im.thumbUrl = signed.get(im.thumbPath) || ''
  }
}

// ---- 圖片載不到時的備援
// 每個放圖的地方本來就有 v-else 佔位，只是條件看的是「有沒有網址」而不是
// 「載得起來嗎」，所以網址在、圖掛掉的時候只剩破圖。記下失敗的網址讓佔位接手。
const brokenImages = reactive(new Set())
export const imageOk = url => Boolean(url) && !brokenImages.has(url)

// 圖載不到有兩種原因，畫面分不出來：網路斷了，或簽名網址過期了（signPaths 只簽
// 1 小時，app 開著放一小時再回來，每一張都會 401，跟網路好壞無關）。
// 所以一律重簽一次：過期的話圖就回來了；真的沒網路的話重簽也會失敗，佔位圖照樣接手。
//
// 整批重簽而不是只簽壞掉那一張：一張過期代表同一批都過期了，而 signPaths 本來就是
// 批次的。一頁二十張同時壞掉也只打一次。
//
// 冷卻時間是必要的，不是節流：重簽會換出新的網址字串，新網址再壞會再觸發 error，
// 沒有冷卻就是無限迴圈打爆 storage。離線時直接不試，那時候一定簽不出來。
const RESIGN_COOLDOWN = 30_000
let resignedAt = 0
export function imageBroken(url) {
  brokenImages.add(url)
  // 本地打包的備援插畫（'/location.png' 之類）沒有簽名可以重簽，壞了就是檔案沒放進去
  if (url?.startsWith('/')) return
  if (store.offline || Date.now() - resignedAt < RESIGN_COOLDOWN) return
  resignedAt = Date.now()
  // 失敗不用處理：attachImageUrls 簽不出來就不動原本的網址，佔位圖已經在畫面上了
  attachImageUrls().catch(() => {})
}

// 剛登入或剛註冊時，Supabase 簽出來的 token 有一兩秒會比 PostgREST 節點的時鐘
// 「還沒到」，查詢就被回 401 JWT issued at future。這是暫時的，等一下就好。
// 沒有重試的話那一次失敗會讓整個 app 停在空的狀態，使用者只看到「還沒有旅程」，
// 得自己重整才會好 —— 實際發生過，而且同一個失敗還會連帶讓剛用邀請連結加入的人
// 卡在一個點不動的畫面（Trip 找不到專案 → 在 setup 裡跳轉 → 跟進行中的導航打架）。
const TRANSIENT = /issued at future|jwt|expired|fetch|network|timeout|50[234]/i
const sleep = ms => new Promise(r => setTimeout(r, ms))

// quiet：背景更新用（回到線上時），不把整頁換成「載入中」，失敗也不跳錯 —— 畫面上已經有資料了
export async function refresh({ retries = 3, quiet = false } = {}) {
  if (!store.me) return
  if (!quiet) store.loading = true
  store.loadError = ''
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        Object.assign(store, await api.loadAll())
        await attachImageUrls()
        store.syncedAt = now()
        warmMediaCache()
        return
      } catch (err) {
        if (attempt >= retries || !TRANSIENT.test(err.message ?? '')) throw err
        await sleep(300 * 2 ** attempt)   // 0.3s → 0.6s → 1.2s，足夠蓋過時鐘偏差
      }
    }
  } catch (err) {
    if (quiet) return
    // 是網路的問題（剛好斷網、訊號太差）而且手機裡有上次的快照：先拿快照頂著，當成離線。
    // 權限、資料錯誤不走這條，那種要讓使用者看到錯誤，不能用舊資料蓋過去
    const network = !navigator.onLine || /fetch|network|timeout/i.test(err.message ?? '')
    if (network && await restoreSnapshot()) { store.offline = true; return }
    // 留給畫面判斷：載入失敗和「真的沒有資料」不一樣，不能都顯示空狀態
    store.loadError = err.message || '載入資料失敗'
    toast(store.loadError)
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
  // 斷網時 Supabase 換不了過期的 token，拿不到登入狀態。手機裡有上次的快照就照它的人開，
  // 不要把人踢回登入頁 —— 在國外沒網路時登入頁是死路。回到線上會再跟伺服器確認一次。
  if (!store.me && store.offline) store.me = (await getSnapshot(SNAPSHOT))?.me ?? null
  if (!store.me) { store.ready = true; return }
  if (store.offline && await restoreSnapshot()) { store.ready = true; return }
  await refresh()
}

// ---- 離線（F-32 / F-33 / F-45）
// 整份資料存一份快照在手機（IndexedDB），斷網打開時拿出來顯示。快照只有一份、屬於最後登入的人，
// 登出就刪掉，換人登入不會看到上一個人的東西。離線期間的勾選（pending）也在快照裡，重開 app 不會掉。
const SNAPSHOT = 'snapshot'
const DATA_KEYS = Object.keys(empty())
async function restoreSnapshot() {
  const snap = await getSnapshot(SNAPSHOT)
  if (!snap || snap.me !== store.me) return false
  Object.assign(store, snap.data, { pending: snap.pending ?? [], syncedAt: snap.syncedAt })
  return true
}
let saveTimer
watch(() => [store.me, store.ready, store.loading, store.pending, ...DATA_KEYS.map(k => store[k])], () => {
  if (!store.me || !store.ready || store.loading || store.loadError) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    // 先轉成純 JSON：IndexedDB 存不了 Vue 的 reactive Proxy（DataCloneError）
    const data = JSON.parse(JSON.stringify(Object.fromEntries(DATA_KEYS.map(k => [k, store[k]]))))
    setSnapshot(SNAPSHOT, { me: store.me, data, pending: JSON.parse(JSON.stringify(store.pending)), syncedAt: store.syncedAt })
  }, 800)
}, { deep: true })

addEventListener('offline', () => { store.offline = true })
addEventListener('online', () => { store.offline = false })

// 手機裡要留的照片與 PDF：還沒結束的旅程裡，清單項目、行程項目、每日備註每組連結的圖，加上航班住宿的 PDF。
// 已結束的旅程、已經刪掉的東西都不在這裡，下面的清理會把它們從手機刪掉。
function offlineMedia() {
  const live = new Set(myTrips().filter(t => !tripPast(t)).map(t => t.id))
  const images = [
    ...[...store.items, ...store.entries].filter(x => live.has(x.tripId)).flatMap(x => x.images ?? []),
    ...store.days.filter(d => live.has(d.tripId)).flatMap(d => (d.links ?? []).flatMap(l => l.images ?? [])),
  ]
  const files = store.entries.filter(e => live.has(e.tripId)).flatMap(e => e.files ?? [])
  return { images, files }
}

// 連網載入完資料之後跑一次（只在有 service worker 的正式版，開發模式抓了也存不起來）：
// 1. 清理：手機裡存著、但已經用不到的照片與 PDF 刪掉，不然每趟旅程的檔案會一直累積下去。
// 2. 預存：縮圖和 PDF 先抓一輪讓 service worker 存起來，斷網時才看得到。
//    原圖不抓（一張一兩百 KB，全部抓太重），看過的原圖 service worker 一樣會留，下次清理時照規則處理。
const MEDIA_CACHE = 'onway-media-v1'   // 跟 public/sw.js 的 MEDIA 同名，改一邊要改另一邊
async function warmMediaCache() {
  if (!navigator.serviceWorker?.controller) return
  const { images, files } = offlineMedia()

  // service worker 存的 key 是去掉簽名 query 的網址：…/storage/v1/object/sign/media/<trip>/<file>
  // 從裡面拆出 bucket 路徑，跟資料裡的 path / thumbPath 比對。頭像（avatars bucket）不在清理範圍
  const keep = new Set([...imagePaths(images), ...files.map(f => f.path)])
  try {
    const cache = await caches.open(MEDIA_CACHE)
    for (const req of await cache.keys()) {
      const m = new URL(req.url).pathname.match(/\/object\/sign\/media\/(.+)$/)
      if (m && !keep.has(decodeURIComponent(m[1]))) await cache.delete(req)
    }
  } catch { /* 清不掉就算了，下次載入再試，不影響使用 */ }

  // 舊版的程式檔也清掉：/assets/* 每次升版檔名都會換（帶 hash），舊的留著沒人會再用，
  // 一版約 700 KB，不清的話每更新一次就多一份。現在這頁載入的就是要留的那份
  try {
    const current = new Set([...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
      .map(el => new URL(el.src || el.href).pathname))
    const shell = await caches.open('onway-shell-v1')   // 跟 public/sw.js 的 SHELL 同名
    for (const req of await shell.keys()) {
      const p = new URL(req.url).pathname
      if (p.startsWith('/assets/') && !current.has(p)) await shell.delete(req)
    }
  } catch { /* 同上 */ }

  const urls = [...images.map(thumbOf), ...files.map(f => f.url)].filter(Boolean)
  // 一次四個，不要一口氣丟幾百個請求把頻寬塞爆
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map(u => fetch(u).catch(() => {})))
  }
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
  delSnapshot(SNAPSHOT)
  store.me = null
  store.ready = true
  store.loadError = ''
  Object.assign(store, empty())
}

// ---- images
// F-27 的前端壓縮。canvas 縮完轉成 Blob 上傳 bucket，資料庫只存路徑。
export const MAX = { avatar: 256, cover: 1024, item: 1600, thumb: 400 }

// 解一次碼，要幾個尺寸就畫幾次。手機拍的照片動輒一千兩百萬畫素，
// 同一張解兩次等於峰值記憶體加倍，iOS Safari 的 canvas 有總量上限，
// 踩到就是整張圖失敗（使用者只會看到「讀不到」）。
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(src) })
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('decode')) }
    img.src = src
  })
}

function scaleTo(img, max) {
  return new Promise((resolve, reject) => {
    const s = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * s)
    c.height = Math.round(img.height * s)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    c.toBlob(b => (b ? resolve({ blob: b, w: c.width, h: c.height }) : reject(new Error('encode'))), 'image/jpeg', 0.82)
  })
}

async function drawScaled(file, max) {
  const { img, release } = await loadImage(file)
  try { return await scaleTo(img, max) } finally { release() }
}

// 回傳 { path, url, w, h, thumbPath, thumbUrl }：path 進資料庫，url 給畫面立刻顯示。
// 另外存一張 400px 的縮圖，是因為列表卡片只有 88px，直接掛 1600px 的原圖等於
// 每張卡片多下載三十倍的量，第一屏六八張就要吃掉兩三 MB。
// 免費方案不能用 image transformation，所以只能在上傳當下自己多存一張。
export async function uploadItemImage(tripId, file, max = MAX.item) {
  const { img, release } = await loadImage(file)
  let full, small
  try {
    full = await scaleTo(img, max)
    small = await scaleTo(img, MAX.thumb)
  } finally { release() }
  const [path, thumbPath] = await Promise.all([
    api.uploadImage(tripId, full.blob),
    api.uploadImage(tripId, small.blob),
  ])
  const signed = await api.signPaths([path, thumbPath])
  return {
    path, url: signed.get(path) || URL.createObjectURL(full.blob), w: full.w, h: full.h,
    thumbPath, thumbUrl: signed.get(thumbPath) || URL.createObjectURL(small.blob),
  }
}

// 刪掉沒有人再引用的 bucket 檔案。共用判斷在 image-rules.js（F-12 的複製品會
// 共用同一個 path），這裡只負責把「還活著的東西」餵進去。
//
// 呼叫時機一定要在資料列真的刪掉之後：順序反過來而寫入失敗的話，rollback 會把
// 項目救回畫面，但檔案已經沒了，使用者看到的是破圖。孤兒檔可以之後再掃，破圖回不來。
//
// 判斷依據是本地 store，所以前提是該專案的項目都已經載進來了（loadAll 會載齊
// 專案內所有成員的項目，包含已離開成員留下的）。行程自己打的地點、每日備註也有圖，一起算活著。
export function sweepImages(candidates) {
  const gone = unusedPaths(candidates, [...imageHolders(), { images: entryFiles() }], store.trips.map(t => t.coverPath))
  if (gone.length) api.removeImages(gone)
}

// 航班與住宿的 PDF 附件：上傳完順手簽一個網址，畫面上點了就能開
export const MAX_FILE_MB = 5
export async function uploadEntryFile(tripId, file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} 超過 ${MAX_FILE_MB} MB`)
  const path = await api.uploadFile(tripId, file)
  const signed = await api.signPaths([path])
  return { path, name: file.name.slice(0, 100), size: file.size, url: signed.get(path) || '' }
}
// 簽名網址只有一小時，app 開著放久了會過期，所以點的當下再簽一次。
// 先同步開一個空分頁再把網址填進去：等簽名回來才 window.open 的話，iOS Safari 會當成彈窗擋掉
//
// 不直接開 Supabase 的網址，而是 fetch 回來轉成 blob 再開：新分頁開別的網域不會經過我們的
// service worker，斷網時就打不開。fetch 會經過它，離線時拿得到預先存好的那份（F-45）。
export async function openFile(f) {
  const w = window.open('', '_blank')
  let url = f.url
  if (!store.offline) url = (await api.signPaths([f.path]).catch(() => new Map())).get(f.path) || url
  try {
    const blob = await (await fetch(url)).blob()
    const local = URL.createObjectURL(blob)
    if (w) w.location = local
    else location.href = local
  } catch {
    w?.close()
    toast(store.offline ? '這個檔案還沒存到手機上，連上網路後再開一次' : '打不開這個檔案')
  }
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
  // 換封面或清掉封面時，舊的那張就沒人引用了。跟項目圖片同一個道理，
  // 一樣等資料列存好才掃，失敗的話寧可留孤兒檔也不要讓畫面變破圖。
  const oldCover = t.coverPath
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
    if (oldCover && oldCover !== t.coverPath) sweepImages([oldCover])
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
  // 清單項目與行程自己打的地點都可能掛著這個地區（資料庫是 on delete set null）
  const affected = [...store.items, ...store.entries].filter(x => x.regionId === r.id)
  affected.forEach(x => { x.regionId = null })
  store.regions.splice(i, 1)
  push(() => api.deleteRegion(r.id), () => {
    store.regions.splice(i, 0, r)
    affected.forEach(x => { x.regionId = r.id })
  })
}

// ---- tags (F-22: per user × trip, max 50；兩池各自算 50)
export function ensureTag(tripId, name, scope = 'default') {
  name = name.trim().slice(0, 20)
  if (!name) return null
  const mine = myTags(tripId, scope)
  const found = mine.find(g => g.name === name)
  if (found) return found
  if (mine.length >= 50) { toast('每個專案最多 50 個標籤'); return null }
  const g = reactive({ id: uid(), tripId, userId: store.me, name, scope })
  store.tags.push(g)
  push(() => api.addTag(tripId, store.me, name, g.id, scope), () => {
    const i = store.tags.indexOf(g)
    if (i >= 0) store.tags.splice(i, 1)
  })
  return g
}
export function renameTag(g, name) {
  name = name.trim().slice(0, 20)
  if (!name || name === g.name) return
  if (myTags(g.tripId, g.scope).some(x => x.name === name && x.id !== g.id)) return toast('已有同名標籤')
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
    // 編輯時移掉的圖片也會變孤兒檔。整包舊 path 都丟去掃就好，還留著的自然算「活著」，
    // 不用在這裡比對哪幾張被拿掉。
    push(() => api.updateItem(existing, before.tagIds).then(() => sweepImages(imagePaths(before.images))),
      () => Object.assign(existing, before))
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
  push(() => api.deleteItem(id).then(() => sweepImages(imagePaths(removed.images))), () => {
    store.items.splice(i, 0, removed)
    snapshot.forEach(s => Object.assign(s.e, { itemId: s.itemId, title: s.title, detachedAt: s.detachedAt }))
  })
}

// F-12：複製他人項目到自己的分頁，標籤依名稱對應到自己的標籤，狀態重設。
// v2.0 共同分頁移除（Q8），複製目標只剩「我的分頁」，所以不再收 target。
export function copyItem(src) {
  const tagIds = src.tagIds
    .map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean)
    // 對應到「自己同一池」的標籤：複製別人的參考，標籤要進我的參考池，不是地點池
    .map(n => ensureTag(src.tripId, n, tagScope(src.type))?.id).filter(Boolean)
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
  if (off) return
  // 斷網時開的 app 可能是拿快照撐著、沒有真的登入狀態，回到線上要先跟伺服器確認
  if (!(await currentUserId().catch(() => null))) return
  if (!store.pending.length) { refresh({ quiet: true }); return }
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
  refresh({ quiet: true })
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

// ---- 行程（F-37 到 F-49）----
// 日期的算法全部在 date-rules.js，那支沒有相依，可以直接跑測試
export { todayISO, addDays, stayNights, stayDayLabel, tripPast } from './date-rules'

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
    ...store.days.filter(d => d.tripId === tripId && (d.note.trim() || d.links?.length || d.refIds?.length)).map(d => d.date),
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
// 航班與住宿有自己的區塊，所以不出現在三個時段的清單裡
const inSlots = e => !e.kind || e.kind === 'place' || e.kind === 'transport'  // kind 未給時等同 place
export const entriesOf = (tripId, date, section, slot) => store.entries
  .filter(e => e.tripId === tripId && e.date === date && e.section === section && e.slot === slot && inSlots(e))
  .sort(byTimeThenOrder)

// 同一天可以有好幾班：同行的人搭不同班
export const flightsOf = (tripId, date) => store.entries
  .filter(e => e.tripId === tripId && e.date === date && e.kind === 'flight')
  .sort(byTimeThenOrder)

// 住宿是唯一跨多天的：一筆從入住日到退房日，中間每一天都看得到它。
// 一趟旅程可以有好幾筆（換飯店），日期重疊也不擋（換宿當天兩邊都看得到）。
export const staysOf = (tripId, date) => store.entries
  .filter(e => e.tripId === tripId && e.kind === 'stay' && coversDate(e, date))
  .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)

// 紅眼航班：抵達時間比起飛早就是隔天到（資料庫的 end_after_start 對 flight 放行）
export const arrivesNextDay = e => Boolean(e.kind === 'flight' && e.startTime && e.endTime && e.endTime < e.startTime)

export function daySummary(tripId, date) {
  const list = store.entries.filter(e => e.tripId === tripId && e.date === date)
  return {
    schedule: list.filter(e => e.section === 'schedule' && inSlots(e)).length,
    meal: list.filter(e => e.section === 'meal').length,
    flight: list.filter(e => e.kind === 'flight').length,
    done: list.filter(e => e.done && e.kind !== 'stay').length,
  }
}

export const dayNote = (tripId, date) =>
  store.days.find(d => d.tripId === tripId && d.date === date)?.note ?? ''
export const dayLinks = (tripId, date) =>
  store.days.find(d => d.tripId === tripId && d.date === date)?.links ?? []
// 引用的參考：讀參考當下的樣子，被刪掉的查不到就略過
export const dayRefs = (tripId, date) =>
  (store.days.find(d => d.tripId === tripId && d.date === date)?.refIds ?? []).map(item).filter(Boolean)

// 引用的是活的資料（Q10）：被引用項目改標題或換照片，行程跟著變。
// F-47 斷開引用後 title 變成快照，這兩支負責把判斷收在一個地方。
export const entryTitle = e => (e.itemId ? item(e.itemId)?.title || e.title : e.title)
// 自己打的地點用自己的圖；引用清單的照片跟著清單走
export const entryImages = e => (e.images?.length ? e.images : (e.itemId && item(e.itemId)?.images) || [])
export const entryThumb = e => thumbOf(entryImages(e)[0])
// 「使用者自己打的」和「引用被刪掉後斷開的」資料長得一模一樣，
// item_id 都是 null、title 都有值，所以必須靠資料庫留下的記號來分，
// 前端推不出來。detached_at 由 F-47 的觸發器寫入。
export const entryDetached = e => Boolean(e.detachedAt)

// F-41 的重複提示與 F-15 的「已排入行程」徽章共用這一支
export const scheduledSlots = itemId => store.entries
  .filter(e => e.itemId === itemId)
  .map(({ date, section, slot }) => ({ date, section, slot }))

// 航班與住宿各自成區，排序跟時段裡的項目不混在一起
const nextOrder = (tripId, date, section, slot, kind) =>
  (kind === 'flight' ? flightsOf(tripId, date)
    : kind === 'stay' ? staysOf(tripId, date)
    : entriesOf(tripId, date, section, slot))
    .reduce((m, e) => Math.max(m, e.order + 1), 0)

function buildEntry(d, order) {
  return reactive({
    id: uid(),
    tripId: d.tripId, date: d.date, endDate: d.endDate ?? null, section: d.section, slot: d.slot,
    kind: d.kind ?? 'place',
    itemId: d.itemId ?? null,
    title: (d.title ?? '').trim(),
    links: d.links ?? [],
    transportMode: d.transportMode ?? '',
    startTime: d.startTime ?? '', endTime: d.endTime ?? '',
    note: d.note ?? '', passengerIds: d.passengerIds ?? [], images: d.images ?? [], files: d.files ?? [], regionId: d.regionId ?? null, done: false, order,
    detachedAt: null,
    createdBy: store.me, updatedBy: store.me,
    createdAt: now(), updatedAt: now(),
  })
}

export function addEntry(data) {
  return addEntries([data])[0]
}

// F-41 從清單加入行程時要建的那一筆。
// 標題與照片繼續引用（Q10：清單改了行程跟著改），但備註與連結是複製一份 ——
// 當天想加「今天只買這個」或換一條路線用的地圖連結，不該回頭改到清單本身。
// 兩個入口（清單卡片選單、行程時段的「從清單選」）都走這裡，規則只有一份。
export const entryFromItem = (it, { tripId, date, section, slot }) => ({
  tripId, date, section, slot, kind: 'place', itemId: it.id, title: '',
  links: JSON.parse(JSON.stringify(it.links ?? [])),
  note: it.note ?? '',
  transportMode: '', startTime: null, endTime: null,
})

// F-41 一次加入多筆。傳進來的順序就是 sort_order 的順序。
// 一次送出，不拆成多次往返，中途失敗才不會留下加了一半的行程。
export function addEntries(list) {
  if (!list.length) return []
  const counters = new Map()
  const built = list.map(d => {
    const key = `${d.date}|${d.section}|${d.slot}|${inSlots(d) ? '' : d.kind}`
    const base = counters.get(key) ?? nextOrder(d.tripId, d.date, d.section, d.slot, d.kind)
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
  // 編輯時拿掉的圖會變孤兒檔，跟 saveItem 一樣等寫入成功再掃
  push(() => api.updateEntry(entry.id, patch).then(() => sweepImages([
    ...('images' in patch ? imagePaths(before.images) : []),
    ...('files' in patch ? (before.files ?? []).map(f => f.path) : []),
  ])),
    () => Object.assign(entry, before))
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
  const order = nextOrder(entry.tripId, target.date, target.section, target.slot, entry.kind)
  Object.assign(entry, target, { order, updatedAt: now(), updatedBy: store.me })
  push(() => api.updateEntry(entry.id, { ...target, order }), () => Object.assign(entry, before))
}

export function deleteEntry(id) {
  const i = store.entries.findIndex(e => e.id === id)
  if (i < 0) return
  const [removed] = store.entries.splice(i, 1)
  push(() => api.deleteEntry(id).then(() => sweepImages([...imagePaths(removed.images), ...(removed.files ?? []).map(f => f.path)])),
    () => store.entries.splice(i, 0, removed))
}

// F-43：空備註不留資料列，清空等於刪掉那一筆
// 每日備註：文字、連結、引用的參考，三個都空才不留資料列（F-43 的延伸）。
// 每日備註的「連結」是一組一組的「標題＋連結＋圖片」，網址和圖片至少要有一樣才算數。
const dayLinkFilled = l => l.url?.trim() || l.images?.length
export function setDayNote(tripId, date, { note, links, refIds }) {
  const fields = {
    note: (note ?? '').slice(0, 500),
    links: (links ?? []).filter(dayLinkFilled),
    refIds: [...(refIds ?? [])],
  }
  const existing = store.days.find(d => d.tripId === tripId && d.date === date)
  const before = existing ? { ...existing } : null
  // 拿掉的圖會變孤兒檔，跟 saveItem 一樣等寫入成功再掃
  const sweepOld = () => before && sweepImages(imagePaths((before.links ?? []).flatMap(l => l.images ?? [])))

  if (!fields.note.trim() && !fields.links.length && !fields.refIds.length) {
    if (!existing) return
    store.days.splice(store.days.indexOf(existing), 1)
    push(() => api.deleteDayNote(tripId, date).then(sweepOld), () => store.days.push(reactive(before)))
    return
  }
  if (existing) {
    Object.assign(existing, fields, { updatedBy: store.me, updatedAt: now() })
    push(() => api.saveDayNote(tripId, date, fields, store.me).then(sweepOld), () => Object.assign(existing, before))
    return
  }
  const created = reactive({ tripId, date, ...fields, updatedBy: store.me, updatedAt: now() })
  store.days.push(created)
  push(() => api.saveDayNote(tripId, date, fields, store.me), () => {
    const i = store.days.indexOf(created)
    if (i >= 0) store.days.splice(i, 1)
  })
}

// ---- 記帳 ----
// 共同帳全員可新增修改；個人帳只有自己看得到（RLS 擋，別人的根本不會載進來）。
// 分攤掛在共同帳底下的 shares，付款人自己那份一律算已付清。
export { splitEven, debts, totals, fmtMoney, decimalsOf, CATEGORIES, categoryOf, byCategory } from './expense-rules'
export const groupExpenses = tripId => store.expenses
  .filter(e => e.tripId === tripId && e.kind === 'group')
  .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
export const myExpenses = tripId => store.expenses
  .filter(e => e.tripId === tripId && e.kind === 'personal' && e.ownerUserId === store.me)
  .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
// 「加入我的記帳」加過了沒：按鈕要變成「已加入」，不能重複加
export const addedToMine = expenseId => store.expenses.some(e => e.sourceExpenseId === expenseId && e.ownerUserId === store.me)

export function saveExpense(data) {
  const existing = store.expenses.find(e => e.id === data.id)
  // 換了付款人的話，舊付款人那份原本是「自動付清」，現在他欠錢了，要退回未付清
  const oldPayer = existing?.payerId
  const shares = data.kind === 'group'
    ? data.shares.map(s => ({ ...s, settled: s.userId === data.payerId || (s.settled && s.userId !== oldPayer) }))
    : []
  const send = e => (e.kind === 'group' ? api.saveGroupExpense(e)
    : existing ? api.updatePersonalExpense(e) : api.createPersonalExpense(e, store.me))
  if (existing) {
    const before = JSON.parse(JSON.stringify(existing))
    Object.assign(existing, data, { shares, updatedBy: store.me, updatedAt: now() })
    push(() => send(existing), () => Object.assign(existing, before))
    return existing
  }
  const e = reactive({
    note: '', payerId: null, ownerUserId: null, sourceExpenseId: null,
    ...data, shares, id: uid(),
    createdBy: store.me, updatedBy: store.me, createdAt: now(), updatedAt: now(),
  })
  store.expenses.push(e)
  push(() => send(e), () => {
    const i = store.expenses.indexOf(e)
    if (i >= 0) store.expenses.splice(i, 1)
  })
  return e
}

export function deleteExpense(id) {
  const i = store.expenses.findIndex(e => e.id === id)
  if (i < 0) return
  const [removed] = store.expenses.splice(i, 1)
  // 資料庫是 on delete set null，本地做同一件事：加進個人帳的那筆留著，只是不再連到來源
  const copies = store.expenses.filter(e => e.sourceExpenseId === id)
  copies.forEach(e => { e.sourceExpenseId = null })
  push(() => api.deleteExpense(id), () => {
    store.expenses.splice(i, 0, removed)
    copies.forEach(e => { e.sourceExpenseId = id })
  })
}

// 共同帳裡我的那份，複製成一筆個人帳。複製不是引用：加進來之後可以自己改
export function addShareToMine(e) {
  const mine = e.shares.find(s => s.userId === store.me)
  if (!mine || addedToMine(e.id)) return null
  return saveExpense({
    tripId: e.tripId, kind: 'personal', ownerUserId: store.me, sourceExpenseId: e.id,
    title: e.title, amount: mine.amount, currency: e.currency, date: e.date, note: '', category: e.category,
  })
}

// 勾一個人在幾筆帳裡的分攤為已付清（或取消）。單筆勾選與「全部結清」共用
function markSettled(list, userId, settled) {
  const hits = list.map(e => [e.id, e.shares.find(s => s.userId === userId)]).filter(([, s]) => s && s.settled !== settled)
  if (!hits.length) return
  hits.forEach(([, s]) => { s.settled = settled })
  push(() => api.setSettled(hits.map(([id]) => id), userId, settled), () => hits.forEach(([, s]) => { s.settled = !settled }))
}
export const toggleSettled = (e, userId) => markSettled([e], userId, !e.shares.find(s => s.userId === userId)?.settled)

// 兩人之間某個幣別的帳一次結清：A 付的、B 有份的，和 B 付的、A 有份的，全部勾掉
export function settlePair(tripId, a, b, currency) {
  const list = groupExpenses(tripId).filter(e => e.currency === currency)
  markSettled(list.filter(e => e.payerId === b), a, true)
  markSettled(list.filter(e => e.payerId === a), b, true)
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
