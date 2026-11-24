-- v2.19.0：交通的「預估時程」（itinerary_entries.duration）。
-- 「約 25 分」「1 小時半」這種寫法直接存文字。
--
-- 只是加一個有預設值的欄位，所以：
--   RLS 不用動 —— 預估時程是 itinerary_entries 的普通欄位，既有的 policy
--     （成員才讀得到、成員才改得動）本來就管得到它。
--   GRANT 不用補 —— GRANT 是表層級的，既有授權自動涵蓋新欄位。
--     （要自己帶 GRANT 的是**新資料表**，見 v2.15.0。）
--   不用回填 —— 舊資料吃 default ''，剛好就是「沒填時程」。
--   不碰 touch 觸發器 —— 這支不做 UPDATE，所以沒有 v2.15.1 那個
--     「回填會把 updated_by 清光」的問題。
--
-- **上線順序**：前端的 insert 一律帶 duration 欄位，所以這支沒跑之前前端不能上，
-- 否則新增行程會整筆失敗（PostgREST 會回「找不到 duration 欄位」）。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- 自由文字，不是分鐘數。存成 int 的話「1 小時半」要先被前端拆成 90，而使用者真正
-- 想寫的常常是「大概」「看路況」這種拆不出數字的話 —— 拆不出來就只能丟掉。
--
-- 這是**行程這一筆**的欄位，不從 items 來（清單的地點沒有「從哪裡過來要多久」
-- 這回事），所以 F-47 的 detach 觸發器不用動：它是逐欄列舉的 UPDATE，沒列到的
-- 欄位原地不動，而原地不動正是這欄要的行為。理由同 v2.18.0 的 important。
--
-- 也不限 kind。畫面目前只有 kind = 'transport' 提供輸入，其他 kind 送空字串，
-- 但限制 kind 等於把前端今天的版面寫死在資料庫裡（理由同 items.pinned_at、
-- items.hours 與 important）。之後想在住宿寫「到機場抓一小時」就得再改一次 schema，
-- 而擋下來的代價是整筆存檔失敗，比畫面上多一個用不到的欄位嚴重得多。
--
-- 20 字跟前端的截斷一致。JS 的 slice(0, 20) 數的是 UTF-16 單位、char_length 數的是
-- 字元，兩者對中日文一樣，對 emoji 是 JS 那邊先砍得更兇 —— 所以前端截過的字串
-- 不可能超過這裡的上限，不會有「前端以為存得進去、資料庫擋下來」的落差。
alter table public.itinerary_entries add column if not exists duration text not null default '';

-- 約束分開寫：add column if not exists 在欄位已存在時（例如這支重跑）會連 inline
-- check 一起跳過，分開 drop / add 才保證跑完一定有這條。
alter table public.itinerary_entries drop constraint if exists itinerary_entries_duration_check;
alter table public.itinerary_entries add constraint itinerary_entries_duration_check
  check (char_length(duration) <= 20);

commit;

-- 驗證：欄位在、not null、預設空字串
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'itinerary_entries' and column_name = 'duration';

-- 驗證：長度約束在，而且是 <= 20（不是 < 20 —— 前端剛好截到 20 字的要存得進去）
select conname as 約束, pg_get_constraintdef(oid) as 定義
from pg_constraint where conname = 'itinerary_entries_duration_check';

-- 驗證：F-47 的觸發器沒有把 duration 寫進 set 清單
select position('duration' in prosrc) = 0 as 觸發器沒碰duration
from pg_proc where proname = 'detach_itinerary_on_item_delete';

-- 既有資料：全部都是沒填時程
select count(*) as 行程筆數, count(*) filter (where duration <> '') as 填了時程的
from public.itinerary_entries;
