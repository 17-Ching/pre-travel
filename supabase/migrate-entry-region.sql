-- 行程的地區（v2.5.0）：自己打的地點也能選地區。
--
-- on delete set null 跟 items.region_id 一樣：地區被刪掉時，行程那筆只是變成
-- 沒有地區，不會連帶被刪（§4.2 刪地區不連帶刪項目，行程比照辦理）。
-- RLS 不用動，沿用 itinerary_entries 既有的成員權限。
--
-- 引用清單的那種（item_id 不為 null）不自己存地區，跟著清單項目走
-- （前端顯示時讀 items.region_id）。自己再存一份就會有兩個可能互相矛盾的地區，
-- 所以用 CHECK 擋住而不是只靠前端自律 —— 跟 v2.4.0 的 images 同一個道理。
-- 加這條是安全的：item_id 只在 insert 時決定，updateEntry 的白名單沒有它，
-- 唯一會動到的是 F-47 的觸發器把它設成 null，那個方向不會違反。
--
-- 沒有擋「跨專案選地區」：那需要 regions 多一組 (id, trip_id) 唯一鍵才能用複合
-- 外鍵做到，而 items.region_id 本來就是普通外鍵、有同樣的理論缺口。為了一個
-- 前端碰不到、而且只會顯示錯地區名稱的情況去動另一張表不划算，保持跟 items 一致。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.itinerary_entries
  add column if not exists region_id uuid references public.regions on delete set null;

alter table public.itinerary_entries drop constraint if exists quoted_entry_has_no_region;
alter table public.itinerary_entries add constraint quoted_entry_has_no_region
  check (item_id is null or region_id is null);

commit;

-- 驗證：欄位在、外鍵是 set null、約束在，而且既有資料全是 null
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'itinerary_entries' and column_name = 'region_id';

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.itinerary_entries'::regclass
  and conname in ('quoted_entry_has_no_region', 'itinerary_entries_region_id_fkey')
order by conname;

select count(*) filter (where region_id is not null) as 有地區的筆數,
       count(*) as 總筆數
from public.itinerary_entries;
