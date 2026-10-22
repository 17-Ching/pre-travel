// Onway 的 service worker（F-31 / F-32 / F-45）：讓 app 斷網也打得開，照片和 PDF 也看得到。
// 手寫不裝 workbox：規則只有三條，套件的設定比這支還長。
//
// 1. 頁面（navigate）：網路優先，斷網拿上次存的 index.html。
//    網路優先是為了「有新版就拿新版」：每次升版都會改 index.html，快取優先的話使用者會卡在舊版。
// 2. 自己網域的靜態檔：快取優先。/assets/* 檔名帶 hash，內容變了檔名就變，不會拿到舊的。
// 3. Supabase storage 的照片與 PDF：網路優先，斷網拿快取。
//    簽名網址的 token 在 query string，每次簽都不一樣，所以快取的 key 去掉 query、只用路徑，
//    同一個檔案只存一份，離線時拿過期的網址也對得到。
//
// 資料本身（PostgREST、Auth）不經過這裡：那些存在 IndexedDB 的快照（src/offline-cache.js）。
const SHELL = 'onway-shell-v1'
const MEDIA = 'onway-media-v1'

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/location.png', '/shop.png', '/trip.png'])))
})

// 換版時清掉舊名字的快取（之後若改快取規則，把上面的 v1 改成 v2）
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MEDIA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // SPA：每條路由都是同一個 index.html，所以統一存在 '/' 底下
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { if (res.ok) caches.open(SHELL).then(c => c.put('/', res.clone())); return res })
      .catch(() => caches.match('/')))
    return
  }

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return   // 連結預覽要即時抓，不快取
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)) }
      return res
    })))
    return
  }

  if (url.pathname.includes('/storage/v1/object/')) {
    const key = url.origin + url.pathname
    // 用 cors 重抓而不是照 <img> 原本的 no-cors：no-cors 拿到的是 opaque 回應，
    // Chrome 會把每一筆 opaque 回應的佔用量灌水到好幾 MB，快取幾百張縮圖就會把配額吃光
    e.respondWith(fetch(req.url, { mode: 'cors', credentials: 'omit' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(MEDIA).then(c => c.put(key, copy)) } return res })
      .catch(() => caches.open(MEDIA).then(c => c.match(key)).then(hit => hit || Response.error())))
  }
})
