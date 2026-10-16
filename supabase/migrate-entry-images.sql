-- 行程的圖片（v2.4.0）：自己打的地點可以放圖。
-- 格式跟 items.images 一樣 [{ path, thumbPath, w, h }]，檔案一樣放 media bucket 的
-- `${trip_id}/<uuid>.jpg`，所以 storage policy 不用動；RLS 也沿用 itinerary 既有的成員權限。
--
-- 引用清單的那種（item_id 不為 null）不自己存圖，照片跟著清單項目走（Q10）。
-- 這條用 CHECK 擋住而不是只靠前端自律：兩邊都存會變成同一個地點出現兩組照片，
-- 而且刪掉清單項目時行程這邊會留下沒人引用的孤兒檔。
-- 加這條是安全的 —— item_id 只在 insert 時決定，updateEntry 的白名單沒有它，
-- 唯一會動到的是 F-47 的觸發器把它設成 null，那個方向不會違反。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.itinerary_entries add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.itinerary_entries drop constraint if exists quoted_entry_has_no_images;
alter table public.itinerary_entries add constraint quoted_entry_has_no_images
  check (item_id is null or images = '[]'::jsonb);

commit;

-- 驗證：欄位在、約束在，而且既有資料全是空陣列
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'itinerary_entries' and column_name = 'images';

select pg_get_constraintdef(oid) as quoted_entry_has_no_images
from pg_constraint
where conrelid = 'public.itinerary_entries'::regclass
  and conname = 'quoted_entry_has_no_images';

select count(*) filter (where images <> '[]'::jsonb) as 有圖的筆數,
       count(*) as 總筆數
from public.itinerary_entries;
