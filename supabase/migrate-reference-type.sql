-- 願望清單多一個第三種子清單「參考」：YouTube 旅遊影片、IG / Threads 行程推薦、
-- 想拍的 reels 參考。跟地點、購物並列。
--
-- 只放寬 items.type 的 CHECK，沒有新欄位。參考項目沿用 title、links、note、
-- region_id、tag 關聯、owner_user_id；visited / purchase_status / planned_store /
-- images 前端不會寫，維持預設值就好，不另外加約束擋（多一條約束只是多一個
-- 將來改需求時要記得拆的東西）。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的
-- 結果（inline check 加上同樣這組 drop / add），之後重建環境會得到同一個形狀。
--
-- 在 Supabase 後台 SQL Editor 貼上執行即可（它預設整段包在一個交易裡）。

begin;

alter table public.items drop constraint if exists items_type_check;
alter table public.items add constraint items_type_check
  check (type in ('place', 'shopping', 'reference'));

commit;

-- 驗證：應該印出含 reference 的那條約束
select pg_get_constraintdef(oid) as items_type_check
from pg_constraint
where conrelid = 'public.items'::regclass and conname = 'items_type_check';
