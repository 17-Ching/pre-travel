-- 每天的備註也能放有標題的連結（v2.7.0）。
--
-- 格式跟 itinerary_entries.links 一樣 [{ id, url, title }]，上限 5 個由前端擋，
-- 跟行程項目一致（那邊也沒有在資料庫擋筆數）。RLS 不用動。
--
-- 規則變了：F-43 原本是「沒有備註就不留資料列」，現在是「備註和連結都空才不留」。
-- 所以之後會出現 note = '' 但 links 不是空陣列的列。確認過 trip_days 沒有東西
-- 擋這件事：note 是 `not null default '' check (char_length(note) <= 500)`，
-- 只限長度不限非空；這張表也沒有觸發器。所以不需要放寬任何約束，加欄位就好。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.trip_days add column if not exists links jsonb not null default '[]'::jsonb;

commit;

-- 驗證：欄位在、預設是空陣列，而且既有資料全被填成空陣列
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'trip_days' and column_name = 'links';

select count(*) filter (where links <> '[]'::jsonb) as 有連結的天數,
       count(*) as 總筆數
from public.trip_days;
