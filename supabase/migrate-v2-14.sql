-- v2.14.0：地點可以填最近車站（items.station、itinerary_entries.station）。
--
-- 純文字，不拆成「路線 / 站名 / 出口」。日本有 JR、地鐵、私鐵交錯，韓國又是
-- 另一套，拆欄位反而填不進去；使用者抄 Google Maps 上看到的那一行就好。
-- 50 字夠寫「JR 新宿站 東口」這種長度。空字串＝沒填，所以舊資料不用回填。
--
-- 規則跟 v2.13.2 的營業時間同一套：行程那一列空的＝讀 items.station，
-- 有值＝這一列自己覆寫。引用別人清單的地點改不動對方的清單，所以覆寫只能存在
-- 行程這一列。不加 quoted_entry 類的約束。
--
-- 同一支還要換掉 detach_itinerary_on_item_delete，理由同 v2.13.2：station 現在
-- 是「空的代表讀清單的」，清單項目被刪掉時沒留快照就會默默消失，而且不報錯。
-- 這是 API-HANDOFF 第 4 節那條通則的第三次 —— 逐欄列舉的 SQL 加欄位要回去補。
-- 我 grep 過 schema.sql，會逐欄列舉這兩張表的只有這支觸發器與 sync_visited_on_done，
-- 後者只碰 visited，不受影響。
--
-- RLS 不用動，也不用補 GRANT。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.items             add column if not exists station text not null default '' check (char_length(station) <= 50);
alter table public.itinerary_entries add column if not exists station text not null default '' check (char_length(station) <= 50);

create or replace function public.detach_itinerary_on_item_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.itinerary_entries
     set item_id = null,
         -- 引用中的 entry 標題本來是空的，填入被刪項目的標題當快照。
         -- 有值的話是這一列自己取的標題，留著（v2.13.2）。
         title   = case when btrim(title) <> '' then title else old.title end,
         -- v2.13.2：營業時間跟 title 同一個道理 —— 空的代表「讀清單的」，
         -- 清單沒了就什麼都不剩，所以斷開時要留下快照。有值的是這一列自己的覆寫，
         -- 不能蓋掉。沒有這兩行的話，標題留著、營業時間卻默默消失。
         hours      = case when hours <> '[]'::jsonb then hours else old.hours end,
         closed_day = coalesce(closed_day, old.closed_day),
         -- v2.14.0：最近車站同理
         station    = case when btrim(station) <> '' then station else old.station end,
         -- 沒有這個記號的話，「使用者自己打的」和「引用被刪掉的」分不出來，
         -- 每一筆自由輸入的項目都會被誤標成「原項目已刪除」
         detached_at = now(),
         updated_at  = now()
   where item_id = old.id;
  return old;
end $$;

commit;

-- 驗證：兩個欄位都在
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and column_name = 'station'
order by table_name;

-- 驗證：觸發器會留下最近車站快照
select position('else old.station end' in prosrc) > 0 as 斷開時保留最近車站
from pg_proc where proname = 'detach_itinerary_on_item_delete';

-- 既有資料：都還沒填
select count(*) filter (where station <> '') as 有填最近車站 from public.items;
