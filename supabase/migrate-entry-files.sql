-- 航班與住宿可以附 PDF（v2.9.0）：電子機票、訂房確認信。
--
-- 格式 [{ path, name, size }]，上限 5 個由前端擋。檔案跟圖片放同一個 media
-- bucket 的 `${trip_id}/<uuid>.pdf`，storage policy 不用動（那幾條只看路徑第一段
-- 是不是自己有份的 trip，不看副檔名）。RLS 也沿用 itinerary_entries 既有的成員權限。
--
-- 加了 files_only_on_flight_stay 約束：其他 kind 掛檔案沒有地方顯示，刪掉的時候
-- 也不會有人想到要清，就變成孤兒檔。kind 在前端建立之後沒有 UI 可以改（編輯表單
-- 是把原本的 kind 原樣帶回去），所以這條不會誤擋既有操作。
--
-- 10/30 的授權變更不影響這支：那條規則是針對「新建的資料表」，這裡只是加欄位。
-- GRANT 是表層級的（這個 schema 沒有任何 column-level grant），既有的
-- select/insert/update/delete 自動涵蓋新欄位。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.itinerary_entries add column if not exists files jsonb not null default '[]'::jsonb;

alter table public.itinerary_entries drop constraint if exists files_only_on_flight_stay;
alter table public.itinerary_entries add constraint files_only_on_flight_stay
  check (kind in ('flight', 'stay') or files = '[]'::jsonb);

-- media bucket 要收得下 PDF。原本沒有設 allowed_mime_types（= 不限類型），
-- 但如果有人在後台加過白名單就會擋掉 application/pdf，所以這裡明確清成 null。
-- 5 MB 上限同時適用圖片與 PDF。
update storage.buckets
set allowed_mime_types = null, file_size_limit = 5242880
where id = 'media';

commit;

-- 驗證：欄位在、約束在、bucket 不限類型
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'itinerary_entries' and column_name = 'files';

select pg_get_constraintdef(oid) as files_only_on_flight_stay
from pg_constraint
where conrelid = 'public.itinerary_entries'::regclass
  and conname = 'files_only_on_flight_stay';

select id, file_size_limit, allowed_mime_types
from storage.buckets where id = 'media';

select count(*) filter (where files <> '[]'::jsonb) as 有附檔的筆數,
       count(*) as 總筆數
from public.itinerary_entries;
