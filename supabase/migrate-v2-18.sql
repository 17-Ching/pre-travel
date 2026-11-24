-- v2.18.0：行程可以標「必去」（itinerary_entries.important）。
-- 卡片上會特別醒目（橘色框＋「★ 必去」），匯出 PDF 也會標星號。
--
-- 只是加一個有預設值的欄位，所以：
--   RLS 不用動 —— 必去是 itinerary_entries 的普通欄位，既有的 policy
--     （成員才讀得到、成員才改得動）本來就管得到它。
--   GRANT 不用補 —— GRANT 是表層級的，既有授權自動涵蓋新欄位。
--     （要自己帶 GRANT 的是**新資料表**，見 v2.15.0。）
--   不用回填 —— 舊資料吃 default false，剛好就是「沒標必去」。
--   不碰 touch 觸發器 —— 這支不做 UPDATE，所以沒有 v2.15.1 那個
--     「回填會把 updated_by 清光」的問題。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- 這是**行程這一筆**的標記，不是地點的屬性：同一間店排在兩天，可以只有一天是
-- 必去。所以不寫回 items，引用清單的那種列也可以自己有值 —— 不加
-- quoted_entry_has_no_* 那類約束（那類約束管的是「兩邊都存會互相矛盾」的欄位，
-- 必去從頭到尾只存在行程這一列，沒有第二個來源）。
--
-- 也不限 kind。畫面目前只有 kind = 'place' 提供切換，但限制 kind 等於把前端
-- 今天的版面寫死在資料庫裡（理由同 items.pinned_at 與 items.hours）。
-- 之後想標「這間飯店一定要住到」就得再改一次 schema，而擋下來的代價是
-- 整筆存檔失敗，比畫面上多一個用不到的旗標嚴重得多。
alter table public.itinerary_entries add column if not exists important boolean not null default false;

commit;

-- 驗證：欄位在、not null、預設 false
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'itinerary_entries' and column_name = 'important';

-- 驗證：F-47 的觸發器沒有把 important 寫進 set 清單。
-- 它是逐欄列舉的 UPDATE，沒列到的欄位原地不動 —— 這正是必去要的行為
-- （欄位本來就在 entry 上，清單項目被刪掉也不該讓它消失或被重設）。
select position('important' in prosrc) = 0 as 觸發器沒碰important
from pg_proc where proname = 'detach_itinerary_on_item_delete';

-- 既有資料：全部都是沒標必去
select count(*) as 行程筆數, count(*) filter (where important) as 標了必去的
from public.itinerary_entries;
