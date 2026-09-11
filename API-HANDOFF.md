# 接 API 交接文件

| 項目 | 內容 |
|---|---|
| 對象 | 之後負責把前端接上真實後端的工程師 |
| 前端現況 | UI 全部完成，資料層是 **localStorage mock**，沒有任何網路請求 |
| 搭配文件 | [PRD.md](PRD.md)（需求與資料模型，以它為準） |
| 日期 | 2026-09-11 |

---

## 0. 先讀這段

前端已經照 PRD 全部做完，但**所有資料都是假的**。整個 mock 層集中在一個檔案：[`src/store.js`](src/store.js)。

**最重要的一句話：接 API 時原則上只需要改 `store.js`，不要動任何 `.vue`。**

所有頁面都只透過 `store.js` 匯出的函式讀寫資料，沒有一個元件自己發請求、自己組 URL。只要你把那些函式換成呼叫後端、並維持相同的**函式簽章與回傳形狀**，UI 就會直接動起來。

有三個地方是例外（`.vue` 裡藏了假邏輯），下面 §3 會逐一點名。

---

## 1. 現在的資料層長怎樣

```js
// src/store.js:146-148
const saved = JSON.parse(localStorage.getItem('pretravel') || 'null')
export const store = reactive(saved?.v === SEED_VERSION ? { ...saved, ... } : seed())
watch(store, s => localStorage.setItem('pretravel', JSON.stringify(s)), { deep: true })
```

- 一個 Vue `reactive` 物件裝下**整個資料庫**：`users / trips / members / regions / tags / items / invites`
- 任何寫入都是直接改這個物件，deep watch 再整包 `JSON.stringify` 存進 localStorage
- 欄位名稱刻意對齊 PRD §4.1，只是用 camelCase（`ownerUserId`、`plannedStore`、`createdAt`…）

**這代表兩件事：**

1. 所有「寫入」目前都是**同步且必定成功**的。接 API 後它們會變成 async 且可能失敗 —— 這是最大的改動點，見 §5。
2. 目前沒有任何權限檢查。前端只是「不顯示按鈕」，任何人改一下 localStorage 就能寫別人的分頁。PRD §7 明寫**前端隱藏按鈕不算授權**，授權一定要在後端做，見 §7。

---

## 2. 建議的技術路線

PRD §8 建議用 BaaS（Supabase / Firebase），理由是權限模型可以直接用 Row-Level Security 表達，不用自己寫後端。這份文件以 **Supabase** 為例，但換成自寫 REST API 也適用，對照表照樣有效。

需要自己寫的伺服器端邏輯**只有一支**：連結預覽 / 圖片轉存（見 §6）。

---

## 3. 三個「假的」資料：頭像、圖片、名稱

這是這份文件的重點，也是最容易接錯的地方。

### 3.1 使用者頭像

**現況**

| 情境 | 現在的值 | 檔案 |
|---|---|---|
| 示範帳號的預設頭像 | `https://i.pravatar.cc/96?u=jean` 外部假圖 | [`store.js:58`](src/store.js#L58) |
| 使用者自己換的頭像 | **base64 data URL**，直接塞在 `user.avatar` 字串裡 | [`Profile.vue:23`](src/pages/Profile.vue#L23) |

換頭像的流程現在是這樣：

```js
// src/store.js:191 — 三種用途一組尺寸，前端 canvas 壓縮
export const MAX = { avatar: 256, cover: 1024, item: 800 }
export function shrinkImage(file, max = MAX.item) { ... }  // 回傳 { url, w, h }
```

**為什麼當初這樣做**：`URL.createObjectURL()` 產生的 `blob:` 網址**重整就失效**，而頭像出現在每一頁，一破圖非常明顯。data URL 可以跟著 localStorage 一起存活。實測一張 600×400 的圖壓完是 3.2 KB。

**接 API 要換成什麼**

1. `User.avatar_url` 存的應該是**儲存空間的 URL 或 key**，不是 base64。
2. 上傳流程改成：選檔 → 前端壓縮（**`shrinkImage` 的 canvas 邏輯可以留著重用**，只是改成輸出 `Blob` 而不是 data URL，用 `canvas.toBlob()`）→ 上傳到 bucket → 拿到 URL → `PATCH /me`。
3. 上傳應該在**按下「儲存」時**才做，不是選檔當下就做。現在的 UI 是選檔立刻顯示預覽（本機的），這個體驗要保留 —— 選檔時用 `URL.createObjectURL()` 做預覽即可（暫時的、不落地，所以 blob 失效沒關係），真正上傳在 `save()` 裡。
4. 上傳失敗要有可見提示並可重試（PRD §7 錯誤處理：**不可靜默丟失**）。

> ⚠️ 注意 Google 登入回傳的 `picture` URL 會過期，而且是外部網域。PRD §7 要求圖片放**私有 bucket**。建議首次登入時把 Google 頭像下載轉存一份，之後都用自己的副本。

### 3.2 項目圖片與旅程封面

**現況**

| 位置 | 現在的做法 | 狀態 |
|---|---|---|
| 項目圖片 [`ItemForm.vue`](src/pages/ItemForm.vue) `addFiles()` | `shrinkImage(file, MAX.item)` → 800 px data URL | 會存活，但是 base64 |
| 旅程封面 [`TripForm.vue`](src/pages/TripForm.vue) `pickCover()` | `shrinkImage(file, MAX.cover)` → 1024 px data URL | 同上 |
| 貼圖片網址 [`ItemForm.vue`](src/pages/ItemForm.vue) `addImageUrl()` | **直接存外部 URL，沒有轉存** | ⚠️ 還是假的 |
| seed 資料 | `https://picsum.photos/seed/...` | 假圖 |

尺寸比 PRD F-27 的 1600 px 保守，是因為原型把圖片塞進 localStorage（~5 MB 上限）。接 API 後圖片在 bucket，**應該調回 1600 px**。

「貼圖片網址」是 §0 說的「`.vue` 裡藏了假邏輯」的例外之一，**必須改**。它不能在前端做：瀏覽器抓跨網域圖片會污染 canvas，`toDataURL()` 直接 throw。這正是 PRD F-28 要求後端下載轉存的原因。

**接 API 要做的**

1. `ItemImage` / `Trip.cover_image_key` 存 bucket 的 key，不存 base64、不存外部 URL。
2. 尺寸調回 F-27 的 1600 px（改 `MAX.item` 即可），輸出改 `canvas.toBlob()` 上傳，canvas 邏輯不用動。
3. 上傳要有進度與取消、失敗可重試（F-27）。現在只有一個 `busy` 旗標擋住重複選檔。
4. 「貼圖片網址」(F-28) 必須走**後端**下載轉存，不能前端直連 —— 原因是 IG / Google 的圖片網址會過期，而且離線需要自己的副本。同一支 serverless function，見 §6。
5. 私有 bucket + 短效簽名網址，或不可猜的 key + 成員驗證（PRD §7）。
6. 刪除 Item 時要**連同 bucket 檔案一起刪**（PRD §4.2）。注意 F-12 複製項目時圖片是「引用同一份檔案，不重複上傳」，所以刪檔前要確認沒有其他 Item 還在引用。

### 3.2.1 ⚠️ 資料模型已偏離 PRD：一個項目多個連結

PRD §4.1 的 `Item` 只有單一 `url` / `url_title` / `url_image_key`。**前端已改成多連結**：

```js
Item.links = [{ id, url, title }]   // title 是使用者自己命名的，最多 5 個
Item.urlImage                        // 保留：卡片縮圖，由第一個抓到預覽的連結提供
// Item.url 與 Item.urlTitle 已移除
```

對應的後端要改成**一對多**（建議 `ItemLink` 資料表：`id / item_id / url / title / sort_order`），
並在 `Item` 上保留一個縮圖欄位。`url` 長度上限沿用 PRD 的 2048，`title` 前端限 40 字。

舊資料的升級邏輯在 [`store.js`](src/store.js) 的 `store.items.forEach` 那段（單一 `url` → 一筆 `links`），
可以直接翻成後端的 migration。

### 3.3 顯示名稱

**現況**

```js
// src/store.js:200
export function updateProfile({ name, avatar }) {
  const u = me()
  name = name.trim().slice(0, 30)
  if (!name) return false
  Object.assign(u, { name, avatar })   // 直接改記憶體裡的物件
  return true
}
```

因為 store 是 reactive 的，改完會自動同步到：分頁列的「我的」、共同分頁的「由誰新增」、成員列表、旅程卡的頭像堆。**接 API 後這個特性要保留** —— 也就是 API 成功回來後，要把新資料寫回 `store.users` 裡對應的那筆，不要只發請求不更新本地狀態，否則畫面不會動。

**要注意的**

- PRD §4.1 `User.display_name` 註明「來自 Google，使用者可改」，所以改名是需求內的，不用另外確認。
- 長度上限 30 字是前端自己定的（PRD 沒寫），後端要對齊或明確給一個值。
- **`User.email` 目前前端完全沒有這個欄位**，但 PRD §4.1 有。接 Google OAuth 時要補進 `store.users` 的資料形狀，個人資料頁也該顯示（唯讀）。

---

## 4. store.js 函式 → API 對照表

以下每一個都要換成真實請求。**簽章不要改**，不然要連 `.vue` 一起動。

### 讀取（目前都是同步 filter/find，接 API 後多半改成載入時抓一次 + 快取）

| 函式 | 行 | 對應 |
|---|---|---|
| `me()` / `user(id)` | 152-153 | `GET /me`、users 快取 |
| `trip(id)` / `myTrips()` | 154, 157 | `GET /trips`（F-02，`updated_at` 新到舊） |
| `tripMembers(tripId)` | 155 | `GET /trips/:id/members` |
| `isOwner(tripId)` | 156 | 由 members 推導即可 |
| `regionsOf(tripId)` | 160 | `GET /trips/:id/regions`（依 `sort_order`） |
| `myTags(tripId)` | 162 | `GET /trips/:id/tags?mine=1` |
| `item(id)` | 164 | items 快取 |

> 建議做法：進專案頁時一次抓齊該 trip 的 regions / tags / items / members 灌進 store（F-35 要求「每次進入專案頁自動拉最新資料」），其餘讀取函式維持現在的同步查本地快取，這樣 `.vue` 完全不用改。

### 寫入（重點）

| 函式 | 行 | 對應 API | 備註 |
|---|---|---|---|
| `login(userId)` | 177 | Google OAuth 2.0 / OIDC | 現在是「選一個示範帳號」，整段要重寫。F-01：登入狀態保留 ≥ 30 天 |
| `logout()` | 178 | 清 session | |
| `updateProfile({name, avatar})` | 200 | `PATCH /me` | 見 §3.1 / §3.3 |
| `createTrip(...)` | 209 | `POST /trips` | 建立者自動成為 owner + 產生個人分頁 |
| `updateTrip(id, ...)` | 215 | `PATCH /trips/:id` | **僅 owner** |
| `deleteTrip(id)` | 218 | `DELETE /trips/:id` | 軟刪除（`deleted_at`），保留 30 天後排程清除 |
| `addRegion / renameRegion / moveRegion / deleteRegion` | 221-244 | `/trips/:id/regions` CRUD | 刪除時把該地區項目的 `region_id` 設 null，**不刪項目** |
| `ensureTag / renameTag / deleteTag` | 246-267 | `/trips/:id/tags` CRUD | 標籤屬於 **user × trip**，每人每專案上限 50 |
| `saveItem(data)` | 269 | `POST` / `PATCH /items` | |
| `deleteItem(id)` | 275 | `DELETE /items/:id` | 連同 ItemImage 與 bucket 檔案 |
| `copyItem(src, target)` | 277 | `POST /items/copy` | F-12：標籤**依名稱**對應到自己的標籤，不存在則建立；購買狀態與 visited 重設；圖片引用同一份檔案 |
| `setStatus(it, patch)` | 282 | `PATCH /items/:id` | **樂觀更新 + 離線佇列**，見 §8 |
| `createInvite / revokeInvite / acceptInvite` | 293-305 | `/invites` | token ≥ 32 bytes 隨機不可猜，7 天有效 |
| `removeMember / leaveTrip` | 307, 310 | `/trips/:id/members/:uid` | 見 PRD §3.3，分頁保留變唯讀 |
| `fetchPreview(url)` | 319 | serverless function | 見 §6，**目前整支是假的** |

### 可以直接刪掉的

| 函式 | 行 | 說明 |
|---|---|---|
| `resetDemo()` | 149 | 原型用，重設示範資料 |
| `seed()` | 60 | 整包假資料 |
| `store.offline` 開關 | Trip.vue 選單 | 原型用來模擬離線，真實版改用 `navigator.onLine` + `online`/`offline` 事件 |

---

## 5. 從同步變非同步：唯一會逼你動 .vue 的地方

現在所有寫入都是同步的：

```js
function save() { saveItem(f.value); router.replace(`/trips/${tripId}`) }
```

接 API 後會變成：

```js
async function save() {
  saving.value = true
  try { await saveItem(f.value); router.replace(...) }
  catch (e) { toast('儲存失敗，請重試') }   // PRD §7：不可靜默丟失
  finally { saving.value = false }
}
```

**建議策略**：讓 store 的寫入函式維持「樂觀更新本地 + 背景送出 + 失敗時回滾並 toast」，這樣絕大多數呼叫端不用改，只有需要顯示 loading 的表單（ItemForm、TripForm、Profile）要加 `await` 和 disabled 狀態。

`toast()`（[`store.js:170`](src/store.js#L170)）已經寫好了，錯誤提示直接用它。

---

## 6. 連結預覽 / 圖片轉存（唯一要自寫的後端）

現在 [`store.js:319 fetchPreview()`](src/store.js#L319) 是假的：一組寫死的 regex 對照表，延遲 900ms 回傳罐頭資料。但**SSRF 的防護邏輯已經先寫進去了**，可以直接照抄到後端：

```js
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1|\[?fc|\[?fd|\[?fe80)/i
```

真實版要做的（PRD F-14 / F-28）：

1. 驗證 URL：只允許 `http` / `https`
2. **DNS 解析後**再檢查是否落在私有網段（只檢查字串會被 DNS rebinding 繞過）
3. 抓取：逾時 5 秒、回應上限 2 MB
4. 跟隨轉址（`maps.app.goo.gl`、`goo.gl/maps` 必須支援）
5. 解析 `og:title` / `og:image` / `og:description`，退回 `<title>`
6. 下載預覽圖 → 壓縮 → 存進自己的 bucket → 回傳 key
7. 圖片轉存（F-28）同一支，大小上限 10 MB

驗收條件（PRD 已寫）：
- 貼 `https://maps.app.goo.gl/xxxx` → 3 秒內帶入店名與圖片
- 貼 `http://192.168.1.1` → 後端拒絕，前端顯示無法預覽

回傳形狀要維持 `{ title, image, description }`，`ItemForm.vue` 直接吃這個。

---

## 7. 權限：前端隱藏按鈕不算授權

前端目前只做到「不顯示」：

```js
// Trip.vue:23
const editable = computed(() => tabOwner.value === null || tabOwner.value === store.me)
```

**這只是 UI，沒有任何實際保護。** 後端必須自己檢查（PRD §7 + F-11 的 AC）：

| 操作 | 檢查 |
|---|---|
| 所有 API | 呼叫者是該 trip 的 **active 成員** |
| 寫入個人分頁項目 | `Item.owner_user_id = 呼叫者` |
| 寫入共同分頁項目 | `Item.owner_user_id IS NULL` 且呼叫者是成員（新增與刪除都開放給任何成員，見 PRD Q2） |
| 編輯 / 刪除專案 | 呼叫者是 `owner` |
| 貼標籤 | `Tag.user_id = 呼叫者`（一個項目只能貼**自己的**標籤，不論項目在哪個分頁） |
| 撤銷邀請 | owner 全部可撤；成員只能撤自己產生的 |

**F-11 的驗收條件明寫：透過 API 直接對他人分頁寫入必須被拒絕（403），前端隱藏不算完成。** 這條要寫測試。

用 Supabase 的話這整張表可以直接寫成 RLS policy。

---

## 8. 離線與同步（F-32 / F-33 / F-34）

目前是模擬的：`store.offline` 是一個手動開關，`store.pending` 是一個陣列，切回線上就清空並 toast。

真實版要做：

| 需求 | 做法 |
|---|---|
| F-32 離線可讀 | 曾在線上開過的專案 → 項目資料存 IndexedDB、縮圖存 Cache Storage。頂端顯示「離線模式・資料為 {時間} 版本」（UI 已做，[`Trip.vue:67`](src/pages/Trip.vue#L67)） |
| F-33 離線可寫 | **只允許**切換購買狀態與已去過。寫入本機佇列（IndexedDB），畫面立即反映，連線後依序送出，成功後清除。其他寫入按鈕停用並提示「需要網路」（UI 已做） |
| 同步失敗 | 例如項目已被刪除 → 顯示提示並丟棄該筆，不可無聲吞掉 |
| F-34 衝突 | Last-write-wins，以 `updated_at` 較新者為準，不做欄位合併，不提示 |
| F-31 PWA | manifest 已在 [`public/manifest.webmanifest`](public/manifest.webmanifest)，**Service Worker 還沒寫** |

`setStatus()` 的樂觀更新結構已經寫好了（[`store.js:282`](src/store.js#L282)），照它的形狀換成真的佇列即可。

---

## 9. 建議的遷移順序

1. **Google 登入 + User**（F-01）—— 其他全部依賴它。做完 `login()` / `logout()` / `me()`
2. **Trips + Members + Invites** —— 有真實使用者才有意義
3. **Regions + Tags** —— 結構簡單，先跑通 CRUD 的 async 改寫模式
4. **Items** —— 量最大，先不含圖片
5. **檔案上傳**（頭像 → 旅程封面 → 項目圖片）—— §3
6. **連結預覽 serverless function** —— §6
7. **PWA + 離線** —— §8，最後做，因為它要求前面全部穩定

1-4 做完就是一個可用的線上版本，5-7 是體驗。

---

## 10. 交接時的驗收清單

前端已完成的部分不需要重做，請對照 [PRD.md 附錄 A](PRD.md) 逐條確認**後端**有接上：

- [ ] Google 登入 / 登出 / 逾期重登，登入狀態保留 ≥ 30 天
- [ ] 未登入開任一網址 → 導向登入 → 登入後回到原網址（前端 router guard 已做，見 [`router.js:33`](src/router.js#L33)）
- [ ] Trip / Region / Tag / Item 的 CRUD 全部走 API
- [ ] **他人分頁寫入回 403**（不是前端擋掉）
- [ ] 頭像、封面、項目圖片都存在私有 bucket，不是 base64 也不是外部 URL
- [ ] 「貼圖片網址」走後端轉存，不是直接存外部連結
- [ ] 圖片前端壓縮調回 F-27 的 1600 px（`MAX.item`），≤ 2 MB
- [ ] 拿掉 [`store.js:150`](src/store.js#L150) 的 localStorage 配額防護（圖片上 bucket 後就不需要）
- [ ] 貼連結 3 秒內帶入店名與圖片；貼私有 IP 被後端拒絕
- [ ] 刪除 Item 連 bucket 檔案一起刪，且不會刪到被複製項目共用的檔案
- [ ] 離線可讀曾開過的專案；離線切換狀態進佇列，連線後自動送出
- [ ] 所有寫入失敗都有可見提示與重試，沒有靜默丟失

---

## 附錄：專案結構

```
src/
  store.js          ← 唯一的資料層，接 API 幾乎只改這裡
  router.js         ← 路由 + 未登入導向
  style.css         ← 設計 token（深淺色兩套值）、共用元件類別、動畫
  pages/
    Login.vue       P-01   現在是「選示範帳號」，要換成 Google OAuth
    Trips.vue       P-02   旅程列表（資料夾卡）
    Profile.vue     P-11   個人資料（姓名 / 頭像）← PRD 沒有，後加的
    TripForm.vue    P-03   建立 / 編輯專案（封面上傳在這）
    Trip.vue        P-04   專案頁：分頁列 / 子清單 / 篩選 / 清單
    ItemForm.vue    P-05   新增 / 編輯項目（連結預覽、圖片上傳在這）
    ItemDetail.vue  P-06
    Members.vue     P-07   成員與邀請
    Regions.vue     P-08
    Tags.vue        P-09
    Invite.vue      P-10   接受邀請
  components/
    TopBar / Sheet / ItemCard / TagChip / Avatar / ThemeToggle
```

**設計層不用動。** `style.css` 的色票、深淺色切換、動畫、`.btn-*` / `.chip-*` / `.card` 等共用類別都已完成，接 API 時不需要碰。
