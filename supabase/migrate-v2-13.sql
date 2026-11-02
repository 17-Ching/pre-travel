-- v2.13.0：參考可以置頂（items.pinned_at）＋ 店家營業時間與公休日
-- （items 和 itinerary_entries 都加 hours、closed_day）。
--
-- 這一版的欄位合成一支，不是照慣例一個主題一支。理由：hours 一旦漏跑，
-- 前端每次存檔都會帶這些欄位，新增或編輯清單項目、行程會整筆失敗。分成兩支
-- 就有「跑了一支、忘了另一支」的空間，合成一支貼一次就不會半套。
--
-- RLS 不用動，也不用補 GRANT：都只是加欄位，GRANT 是表層級的，
-- 既有授權自動涵蓋新欄位。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- ── 1. 置頂 ──────────────────────────────────────────────────
-- 用 timestamptz 不用 boolean：置頂時間本身就是排序依據，前端照新到舊排，
-- 最近置頂的在最上面。用 boolean 的話還要再加一個欄位才排得出順序。
-- null = 沒置頂，所以舊資料不用回填。
--
-- 欄位不限 type。目前只有 type = 'reference' 的介面會用到，但限制 type 等於
-- 把前端今天的畫面寫死在資料庫裡，之後地點或購物想置頂就得再改一次 schema。
--
-- RLS 不動：置頂是 items 的一個普通欄位，items_update 本來就要求
-- owner_user_id = auth.uid()，所以只有本人改得動自己的項目。別人看得到你的參考，
-- 也就看得到你置頂了哪幾支 —— 這跟參考本身的可見度一致，不另外遮。
alter table public.items add column if not exists pinned_at timestamptz;

-- ── 2. 營業時間 ──────────────────────────────────────────────
-- 時段陣列 [{ "open": "11:00", "close": "14:30" }, ...]，時間是 "HH:MM" 字串。
-- 用陣列而不是兩個欄位，是因為餐廳會有午休：中午一段、晚上一段，各自有起訖。
-- close 可以早於 open —— 營業到半夜的 18:00–02:00 是合法的，不要加約束擋掉。
-- 跟 itinerary_entries.start_time 同一個原則（D8）：存當地時間，不做時區換算。
--
-- 內容不驗格式，跟 links / images / files 一致。時間是 <input type="time">
-- 產生的，源頭就只會是 HH:MM，在資料庫再驗一次只擋得到前端自己的 bug，
-- 而那種 bug 會讓整筆存檔失敗，比畫面上顯示一個怪時間更難處理。
-- 真要驗的話 CHECK 裡不能寫子查詢，得先做一個 immutable 函式再引用。
alter table public.items             add column if not exists hours jsonb not null default '[]'::jsonb;
alter table public.itinerary_entries add column if not exists hours jsonb not null default '[]'::jsonb;

-- ── 3. 公休日 ────────────────────────────────────────────────
-- 三種狀態要分得開：
--   null   使用者沒選 → 畫面不顯示這一行
--   'none' 使用者選了「無」→ 畫面顯示全年無休
--   其餘   那一天公休
-- 「沒選」用 null 而不是另一個字串，是因為舊資料加完欄位本來就是 null，
-- 剛好就是「沒選」，不用回填。單選，所以是一個欄位不是陣列。
alter table public.items             add column if not exists closed_day text;
alter table public.itinerary_entries add column if not exists closed_day text;

alter table public.items drop constraint if exists items_closed_day_check;
alter table public.items add constraint items_closed_day_check
  check (closed_day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'none'));
alter table public.itinerary_entries drop constraint if exists itinerary_entries_closed_day_check;
alter table public.itinerary_entries add constraint itinerary_entries_closed_day_check
  check (closed_day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'none'));

-- ── 4. 引用的行程不自己存營業時間 ────────────────────────────
-- 畫面讀 items 的值（Q10）。這條跟 quoted_entry_has_no_images、
-- quoted_entry_has_no_region 是同一個規則：兩邊都存就會有兩個可能互相矛盾的值，
-- 而且使用者改了清單那邊之後，行程這邊會留著舊的，沒有任何地方會提醒他。
--
-- 兩個欄位都要管。只擋 hours 的話，公休日還是會各存一份 —— 營業時間一致、
-- 公休日不一致，比兩個都不一致更難發現。
alter table public.itinerary_entries drop constraint if exists quoted_entry_has_no_hours;
alter table public.itinerary_entries add constraint quoted_entry_has_no_hours
  check (item_id is null or (hours = '[]'::jsonb and closed_day is null));

commit;

-- 驗證：五個欄位都在、型別與預設值正確
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('items', 'pinned_at'), ('items', 'hours'), ('items', 'closed_day'),
    ('itinerary_entries', 'hours'), ('itinerary_entries', 'closed_day'))
order by table_name, column_name;

-- 驗證：公休日限八個值、引用的行程兩個欄位都不准自己存
select conrelid::regclass as 資料表, conname as 約束, pg_get_constraintdef(oid) as 定義
from pg_constraint
where conname in ('items_closed_day_check', 'itinerary_entries_closed_day_check',
                  'quoted_entry_has_no_hours')
order by 1, 2;

-- 既有資料：全部未置頂、沒有營業時間、沒選公休日
select count(*) filter (where pinned_at is not null)  as 已置頂,
       count(*) filter (where hours <> '[]'::jsonb)   as 有填營業時間,
       count(*) filter (where closed_day is not null) as 有選公休日
from public.items;
