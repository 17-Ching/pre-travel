-- ============================================================
-- v1 → v2.0 一次性遷移（行程頁）
--
-- ⚠️ 這份會刪除資料，而且無法復原。不要連跑，先跑第 0 段看清單。
--
-- 為什麼跟 schema.sql 分開：schema.sql 是「資料庫應該長什麼樣」，
-- 設計成可以隨時重複執行。把 DELETE 放進那種檔案遲早會有人手滑整包重跑。
-- 全新的資料庫只要跑 schema.sql，不需要這一份。
--
-- 執行順序：
--   0. 先跑「盤點」那段，確認要刪什麼、要補什麼
--   1. 確認後再跑「執行」那段
--   2. 最後重跑一次 schema.sql，把新的 policy 與觸發器補上
-- ============================================================


-- ---------- 0. 盤點（唯讀，先跑這段） ----------

-- 0a. 共同分頁有哪些項目會被刪掉（Q8：行程取代共同分頁）
select t.name as 專案, i.type, i.title, i.created_at::date as 建立日
from public.items i
join public.trips t on t.id = i.trip_id
where i.owner_user_id is null
order by t.name, i.created_at;

-- 0b. 總計
select count(*) as 將被刪除的共同分頁項目數 from public.items where owner_user_id is null;

-- 0c. 哪些專案缺日期（v2.0 起 start_date / end_date 必填）
select id, name, start_date, end_date, created_at::date as 建立日
from public.trips
where deleted_at is null and (start_date is null or end_date is null);

-- 0d. 日期顛倒的專案（新的 CHECK 會擋）
select id, name, start_date, end_date
from public.trips
where deleted_at is null and start_date is not null and end_date is not null and end_date < start_date;


-- ---------- 1. 執行（確認 0 的結果之後再跑） ----------

begin;

-- 1a. 刪掉共同分頁的項目。
-- 使用者決定：直接刪，不處理歸屬、不搬給任何人。
-- item_tags 由 FK 的 on delete cascade 自動清掉。
-- 注意：這些項目的圖片會留在 media bucket 變成孤兒檔，本專案目前沒有做
-- storage 清理（見 API-HANDOFF.md 第 7 節），需要的話另外手動清。
delete from public.items where owner_user_id is null;

alter table public.items alter column owner_user_id set not null;

-- 1b. 專案日期補值後設為必填。
-- 沒有日期的專案用建立日當單日行程，使用者之後可以自己改。
-- 這是保守做法：寧可給一個看得出來要修的值，也不要讓遷移整個失敗。
update public.trips set start_date = created_at::date where start_date is null;
update public.trips set end_date   = start_date        where end_date is null;
update public.trips set end_date   = start_date        where end_date < start_date;

alter table public.trips alter column start_date set not null;
alter table public.trips alter column end_date   set not null;

do $$ begin
  alter table public.trips add constraint trip_dates_ordered check (end_date >= start_date);
exception when duplicate_object then null;
end $$;

commit;


-- ---------- 2. 接著做 ----------
-- 重新執行 supabase/schema.sql。它會建立 itinerary_entries 與 trip_days、
-- 新的 policy 與 F-47 / D1 兩個觸發器，並把 policy 裡的共同分頁分支清乾淨。


-- ---------- 3. 驗證（跑完之後確認） ----------

-- 應該回 0
select count(*) as 還有共同分頁項目嗎 from public.items where owner_user_id is null;

-- 應該都是 NO
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (table_name = 'items' and column_name = 'owner_user_id'
       or table_name = 'trips' and column_name in ('start_date', 'end_date'));

-- 應該看得到兩張新表
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('itinerary_entries', 'trip_days');
