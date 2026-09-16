# Onway — 架構與交接說明

| 項目 | 內容 |
|---|---|
| 對象 | 之後要維護或接手這個專案的人 |
| 後端 | Supabase（Postgres + RLS + Auth + Storage），已接上 |
| 搭配文件 | [PRD.md](PRD.md) v2.2（原始需求）。本文件記錄**實作最後長什麼樣**，與 PRD 不一致處以本文件為準 |
| 日期 | 2026-09-16 |

> **命名**：產品名 **Onway**（O 大寫、w 小寫，不空格不加連字號，PRD §0）。
> UI 語言仍是繁中，只有產品名是英文。程式裡還留著幾個 `pretravel`
> 字樣是**故意的**，它們不是顯示文字，改了會壞：
> `USER_DOMAIN = 'pretravel.app'`（改了所有既有帳號登不進去）、
> localStorage 的 `pretravel-theme` / `pretravel-prefs`（改了使用者的主題與篩選被重設）、
> schema.sql 的 `pretravel_*` storage policy 名稱（改了要跑 DB 遷移）。

> 沿革：2026-09-11 原本是「給之後接 API 的人」的待辦清單，資料層接完後改寫成
> 現況說明。2026-09-14 PRD 出 v2.0（行程頁、共同分頁移除），本文件同步更新。

---

## 0. 三十秒版本

- 前端是 Vue 3 + Vite，部署在 Vercel。
- 資料在 Supabase，權限由 Postgres 的 RLS 決定，前端沒有任何後端 API 要維護。
- 唯一自寫的伺服器端程式是 [`api/preview.js`](api/preview.js)，跑在 Vercel Functions，負責連結預覽與圖片轉存。
- 登入是**帳號密碼**，不收 email。
- 一個專案有兩種東西：**清單**（每人一個分頁，他人的唯讀）與**行程**（全隊共用一份，按日期排）。v2.0 起沒有共同分頁。
- 尚未完成的只有離線與 PWA（PRD F-31 到 F-34、F-45）。

---

## 1. 檔案分工

三個檔案各有明確邊界，不要混用：

| 檔案 | 行數 | 職責 | 不該出現的東西 |
|---|---|---|---|
| [`src/supabase.js`](src/supabase.js) | 83 | 建立 client、帳號密碼登入註冊、簽名網址 | 任何業務邏輯 |
| [`src/api.js`](src/api.js) | 313 | 所有 Supabase 查詢與寫入、snake_case 轉 camelCase | Vue 的東西、畫面狀態 |
| [`src/store.js`](src/store.js) | 649 | 畫面的資料來源、樂觀更新、回捲、toast | 直接呼叫 Supabase |

**資料庫是 snake_case，畫面用 camelCase，轉換全部關在 `api.js` 裡。** 其他檔案看不到 `owner_user_id` 這種名字。

`src/auth-rules.js`（13 行）是帳號密碼的驗證規則，刻意不 import Supabase SDK，任何地方都能安全 import。`supabase.js` 從它 re-export，規則只有一份定義。`src/date-rules.js` 同樣的道理：日期字串運算與住宿的跨日規則放在那裡，`store.js` re-export，`node scripts/check.mjs` 才測得到（store.js 在模組載入時就會碰 `localStorage`，Node 直接 import 會炸）。

---

## 2. store 是本地鏡像，不是快取層

```
登入 → api.loadAll() 一次撈回使用者看得到的全部資料 → 灌進 reactive store
頁面讀資料：同步，直接讀 store（myTrips()、regionsOf()、item(id)…）
頁面寫資料：呼叫 store 的函式，它先改本地，再背景送出
```

**讀取維持同步是刻意的**，因為這樣所有 `.vue` 讀資料的寫法都不用改。RLS 已經把範圍限制在使用者參與的專案，朋友等級的資料量一次撈完最省事，也直接鋪好了離線快取的路。

### 2.1 樂觀寫入

```js
export function addRegion(tripId, name) {
  const r = reactive({ id: uid(), tripId, name, order: ... })
  store.regions.push(r)                       // 本地先改，畫面立刻反應
  push(() => api.addRegion(...), () => {      // 背景送出，失敗回捲
    store.regions.splice(store.regions.indexOf(r), 1)
  })
  return r                                     // 同步回傳，呼叫端不用 await
}
```

id 由前端用 `crypto.randomUUID()` 產生再送上去，兩邊才指向同一筆。

**只有四支是 async**，因為呼叫端真的需要等結果：`createTrip`（id 由 RPC 產生）、`updateTrip`、`updateProfile`、`acceptInvite`。其餘全部同步。

### 2.2 寫入必須排成一條序列

`store.js` 的 `push()` 把所有寫入排進同一條 promise 鏈，**這不是為了節流**：

使用者在項目表單裡順手新增地區時，本地兩筆立刻就有了，但送到伺服器如果亂序，項目會因為地區還不存在而踩到外鍵錯誤。這是實測撞出來的，不是理論問題。所以 `push()` 收的是「還沒發動的函式」，輪到它才真的送出。

改這段之前先想清楚為什麼它長這樣。

---

## 3. 權限：PRD §7 那張表對應到哪個 policy

授權全部在資料庫。前端隱藏按鈕只是 UI，繞過去也寫不進來。

| PRD 要求 | 實際的 policy | 位置 |
|---|---|---|
| 所有 API 檢查呼叫者是 active 成員 | `is_trip_member()` 被幾乎每條 policy 引用 | schema.sql |
| 寫入個人分頁檢查 `owner_user_id = 呼叫者` | `items_insert` / `items_update` 的 `owner_user_id is null or owner_user_id = auth.uid()` | 同上 |
| 共同分頁任何成員可增可刪（Q2） | 同上，`owner_user_id is null` 那一半 | 同上 |
| 他人分頁唯讀（F-11） | 上面兩條的反面，已有測試覆蓋 | rls-test.sql |
| 編輯／刪除專案限 owner | `trips_update` + `delete_trip` RPC 內的檢查 | 同上 |
| 只能貼自己的標籤（§4.2） | `item_tags_insert` 同時檢查項目可寫與標籤屬於自己 | 同上 |
| 撤銷邀請：owner 全部，成員限自己產生的 | `invites_update` | 同上 |
| 擁有者不能自行離開 | `owner_cannot_leave` CHECK 約束，不是 policy | 同上 |
| **行程**：任何 active 成員都能增刪改 | `itinerary_*` 四條、`trip_days_all` | 同上 |

共 31 條 policy、4 支 RPC（`create_trip` / `delete_trip` / `invite_preview` / `accept_invite`）、6 個觸發器。

行程刻意**沒有** `owner_user_id`，不設個人隔離。PRD §3.2 的理由：行程的價值在於大家看同一份，個人的想法放在自己的清單分頁。

**輔助函式一律 `security definer`**，因為 policy 互相引用會無限遞迴。改 policy 前先理解這點。

### 3.1 驗證方式

[`supabase/rls-test.sql`](supabase/rls-test.sql) 有 54 項斷言，以兩個不同使用者的身分實際讀寫，涵蓋他人分頁唯讀、標籤只有自己看得到、非成員完全看不到、刪地區不連帶刪項目、行程權限、slot 組合限制、D1 連動的兩種情況、F-47 的斷開行為等。

```bash
psql -f supabase/rls-test.sql
```

它會先補上 Supabase 專有的 auth / storage 替身再載入 schema，所以要跑在**用完就丟的本機 Postgres**，不要對正式資料庫執行。改動 schema 後請重跑。

---

## 4. 只有這個專案才有的坑

這些規則藏在 SQL 或設定裡，只看前端看不到，最容易被下一個人重複實作或踩到。

**帳號大小寫**
`profiles` 的唯一索引是 `lower(username)` 函式索引，所以 Jean 和 jean 搶不到同一個帳號，但**存進去的是使用者打的原樣**。要用帳號查詢時條件必須寫 `lower(username) = lower($1)` 或 `ilike`，直接 `.eq('username', x)` 會變成大小寫敏感而且吃不到索引。

**顯示名稱留空的 fallback 在資料庫**
`handle_new_user` 觸發器會 `coalesce(nullif(display_name,''), username)`。前端**不要**再補一份，規則放兩個地方遲早不一致。

**RLS 擋 UPDATE / DELETE 時不會報錯**
只是靜默影響 0 筆。所以「沒有 error」不等於「成功」。`api.js` 的 `must()` 會數筆數，新增寫入時請沿用它。

**軟刪除必須走 RPC**
PostgreSQL 對 UPDATE 會把 SELECT 政策也套用在新列上，而 `trips_select` 含 `deleted_at is null`。所以直接 `update trips set deleted_at` 會被自己的讀取政策擋掉。已經改成 `delete_trip` RPC，不要改回去。

**假網域鎖死了**
帳號密碼登入把帳號接上 `@pretravel.app` 湊出 Supabase Auth 需要的 email 格式。Supabase 會拒絕 `.local` 之類的非真實 TLD。**這個值一旦有人註冊就不能再改**，改了等於所有既有帳號都登不進去。

**自由輸入的行程項目與被斷開引用的行程項目，資料形狀一模一樣**
兩種都是 `item_id` 為 null、`title` 有值，前端分不出來。靠 `detached_at` 區分，由 F-47 的觸發器在斷開時寫入。不要改回用「沒有 itemId 又有 title」判斷，那會把每一筆使用者自己打的項目都標成「原項目已刪除」。

**D1 的「影響 0 筆」是預期結果，不是失敗**
勾完成時只同步自己的地點的 `visited`，引用他人的就是 0 筆。這跟本專案其他地方「0 筆等於被 RLS 拒絕」的判讀相反，不要在那裡加 `must()`。

**日期不要用 `new Date()` 解析**
`new Date('2026-11-12')` 會被當成 UTC 午夜，在 UTC+8 算出來是前一天。日期一律用 `'YYYY-MM-DD'` 字串比較與加減，時間一律用 `'HH:MM'` 字串。這是 PRD D8 說的「不做時區換算」在程式碼裡的具體做法。

**Supabase 的 Confirm email 必須維持關閉**
信箱是假的，確認信永遠收不到。開著的話新帳號會卡在未確認而登不進去。

---

## 5. 與 PRD 不一致的地方

| PRD 怎麼寫 | 實際怎麼做 | 為什麼 |
|---|---|---|
| F-01 Google OAuth 登入 | **帳號密碼**，完全不收 email | 只給自己和朋友用，接 OAuth 要另外申請用戶端。代價是沒有自助的忘記密碼，要在 Supabase 後台協助重設 |
| §4.1 `Item` 單一 `url` / `url_title` | `items.links` jsonb 陣列，最多 5 個命名連結 | 一間店常常同時有 Maps 和 IG 兩個來源 |
| §4.1 `Item.url_image_key` 縮圖欄位 | **已移除**。連結預覽圖會轉存成第一張 `images` | 少一個欄位，卡片縮圖直接取 `images[0]` |
| §4.1 `ItemImage` 獨立資料表 | `items.images` jsonb 陣列，存 `{ path, w, h }` | App 從不單獨查圖片，拆表只是多一次 join |
| §4.1 `User.email` | 沒有這個欄位 | 帳號密碼登入拿不到也不需要 email |
| §4.1 `ItineraryEntry` 欄位表 | 多一個 `detached_at` | 沒有它就分不出「自己打的」和「被斷開的」，見第 4 節 |
| F-27 圖片壓縮 1600 px | 已對齊（`MAX.item = 1600`） | 原型受 localStorage 限制才壓到 800 |
| F-44 跨日拖曳 | 改成卡片選單「搬到其他天」 | 使用者決定，v1 不做拖曳 |
| F-40 有時間的項目可拖曳排序 | 不給拖曳握把，改顯示「有時間的項目會依時間自動排序」 | PRD 原設計是「存了排序但畫面不動只跳提示」，那會被當成壞掉 |

v2.0 已隨共同分頁一起消失的東西：F-25 標籤同名合併、§4.2 的標籤合併規則。

---

## 6. 連結預覽與圖片轉存

[`api/preview.js`](api/preview.js)（156 行）跑在 Vercel Functions，**不需要任何環境變數**。

`GET /api/preview?url=...` 回傳 `{ title, description, image }`，`image` 是 data URL。前端拿到後走 `uploadImageFromDataUrl()` 壓縮上傳 bucket，資料庫只存路徑。

已實作的防護（PRD F-14）：只允許 http/https、每一跳轉址都重新解析 DNS 並擋私有網段、逾時 5 秒、頁面上限 2 MB、圖片上限 5 MB、最多 5 次轉址。日文網站的 Shift_JIS / EUC-JP 有處理。

貼圖片網址（F-28）走同一支：content-type 是 `image/*` 時整包當圖片回傳。

**已知限制**：DNS 解析後仍用 hostname 連線，理論上擋不掉 DNS rebinding。要根治得自己接 socket 綁 IP 並保留 SNI，對這個規模不值得，程式碼裡有註記。

純函式（私網判斷、OG 解析、編碼偵測、帳號規則）有自我檢查：

```bash
node scripts/check.mjs
```

**本機測 `/api/preview` 要用 `vercel dev`**，Vite 的 dev server 不會跑 api 資料夾。

---

## 7. 還沒做完的

| 項目 | 狀態 |
|---|---|
| F-31 PWA Service Worker | **未做**。manifest 在 [`public/manifest.webmanifest`](public/manifest.webmanifest)，SW 完全沒寫 |
| F-32 離線可讀 | **未做**。沒有 IndexedDB 也沒有 Cache Storage |
| F-33 離線可寫 | **半套**。`store.offline` 還是 Trip 頁選單裡的手動開關，`store.pending` 只存在記憶體，重整就消失。真實版要改用 `navigator.onLine` 加上 `online`/`offline` 事件，佇列落地 IndexedDB。佇列已經能裝兩種東西（清單項目的狀態、行程項目的完成），用 `kind` 區分 |
| F-45 行程離線 | **未做**，依賴上面三條，照使用者決定整批往後 |
| F-34 衝突處理 | 未做。目前誰後寫誰贏，但沒有比對 `updated_at` |
| 刪除項目時清掉 bucket 檔案 | **未做**。刪項目只刪資料列，圖片會變成孤兒檔。注意 F-12 複製項目時圖片是共用同一個 path，所以要刪檔前得確認沒有其他項目還在引用 |

### 7.1 已經端對端實測過的

以真實 Supabase 專案、兩個不同帳號跑過，不是模擬：

- 註冊、登入、跨重整保持登入、顯示名稱留空時繼承帳號
- 建立專案、新增地區、在項目表單當場新增地區與標籤後存檔、重整後資料仍在、軟刪除專案
- **圖片上傳**：資料庫存的是 path 不是網址；重整後 path 不變、簽名 token 換新；實際 fetch 回 200 `image/jpeg`；有效期 3600 秒；**非上傳者的其他成員也讀得到**（`media` 私有 bucket 的 RLS 正確）
- **邀請流程**：未登入開 `/invite/<token>` 會導到登入頁且 token 完整保留，登入後回到邀請頁，`invite_preview` RPC 對非成員有效，加入後看得到擁有者的項目
- **權限矩陣在真實環境的行為**：改他人分頁靜默 0 筆、插入他人分頁 42501、偽造 `created_by` 42501、成員改專案名稱 0 筆、擁有者自行離開 23514、成員離開後項目仍保留（PRD §3.3）
- **v1 → v2.0 遷移**：先在 v1 形狀的本機資料庫驗過（共同分頁項目被刪、個人項目一筆沒動、標籤關聯連帶清掉、缺日期的專案用建立日補值），再跑正式環境，八項驗收全過
- **行程**：三種新增方式、`addEntries` 多筆順序、F-40 排序、D1 連動的兩種情況、F-47 刪地點後兩筆引用都存活且標題快照正確、`setDayNote`、`moveEntry` 跨日跨時段、F-46 縮短日期後範圍外那天排到最後且資料一筆沒少。寫入後都呼叫 `refresh()` 從伺服器重讀比對，不是只看本地樂觀更新的結果

---

## 8. 環境與設定

```bash
npm run dev          # Vite，不含 /api
vercel dev           # 含 /api，要測連結預覽用這個
npm run build
node scripts/check.mjs
```

環境變數只有兩個，見 [`.env.example`](.env.example)。本機放 `.env.local`（已 gitignore），線上放 Vercel 的 Settings → Environment Variables，**加完必須重新部署**才會生效，因為 `VITE_` 開頭的變數是建置時打包進去的。

anon key 要整串原樣貼，不要把 `sb_publishable_` 前綴接在 JWT 前面湊，那會回 401。絕對不要用 secret key 或 service_role，它們會繞過所有 RLS。

Supabase 那邊的設定：Confirm email 關閉；`media` bucket 私有、`avatars` bucket 公開，兩個都由 `schema.sql` 建立。

---

## 附錄：專案結構

```
api/preview.js        連結預覽 / 圖片轉存（Vercel Function，唯一的伺服器端程式）
supabase/
  schema.sql          資料表、RLS、RPC、觸發器、Storage。可重複執行
  migrate-v2.sql      v1 → v2.0 的一次性遷移。會刪資料，跟 schema.sql 刻意分開
  rls-test.sql        權限驗證，54 項。跑在用完就丟的本機 Postgres
scripts/check.mjs     純函式自我檢查
src/
  supabase.js         client、帳號密碼登入、簽名網址
  api.js              所有 Supabase 存取與欄位轉換
  store.js            畫面資料來源、樂觀更新
  auth-rules.js       帳號密碼驗證規則的唯一定義
  date-rules.js       日期字串運算與住宿的跨日規則，無相依，check.mjs 直接測這支
  link-preview.js     F-14 連結預覽的共用狀態機，清單表單與行程表單都用這支
  router.js           路由 + 未登入導向（會等 bootstrap 讀完 session）
  style.css           設計 token、共用元件類別、動畫
  pages/
    Login.vue       P-01   帳號密碼登入與註冊
    Trips.vue       P-02   旅程列表
    Profile.vue     P-11   個人資料（PRD 沒有，後加的）
    TripForm.vue    P-03   建立 / 編輯專案，封面上傳
    Trip.vue        P-04   分頁列（願望清單 / 行程）→ 清單裡再選誰的 / 子清單 / 篩選 / 清單
    ItemForm.vue    P-05   新增 / 編輯項目，連結預覽與圖片上傳
    ItemDetail.vue  P-06
    Members.vue     P-07   成員與邀請
    Regions.vue     P-08
    Tags.vue        P-09
    Invite.vue      P-10   接受邀請，走 invite_preview RPC
  components/
    Itinerary.vue   行程分頁的完整版面：日期列、出發／回程航班區、住宿區、三時段、五餐別、每日備註
    EntryCard.vue   行程卡片：一般 / 交通 / 航班 / 住宿四種樣式、時間徽章（紅眼班機標 +1）、乘客頭像、完成勾選
    TopBar / Sheet / ItemCard / TagChip / Avatar / ThemeToggle
```

**設計層不用動。** `style.css` 的色票、深淺色切換、動畫、`.btn-*` / `.chip-*` / `.card` 等共用類別都已完成。
