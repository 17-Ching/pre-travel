-- v2.13.2：引用別人清單的行程，可以自己填營業時間蓋過清單的值。
--
-- 拿掉 quoted_entry_has_no_hours。那條約束在 v2.13.0 是對的：當時引用列的
-- 營業時間只可能是清單的副本，兩邊都存就會互相矛盾。現在它不是副本而是覆寫 ——
-- 別人的清單項目你改不動（items_update 限本人），想在自己的行程裡改營業時間
-- 就只能存在這一列。空的＝沿用清單的值，有值＝這一列自己說了算。
--
-- images 與 region_id 的兩條約束沒有跟著拿掉，它們仍然只能由清單那邊決定。
-- 如果之後那兩個也要能覆寫，要另外決定，不是順手一起放行。
--
-- 同一支還要換掉 detach_itinerary_on_item_delete。理由跟 v2.12.0 的 RPC 一樣是
-- 沉默失敗：hours 現在跟 title 一樣是「空的代表讀清單的、有值代表自己覆寫」，
-- 清單項目被刪掉時 title 有留快照、hours 沒有，結果會是標題留著、營業時間
-- 默默消失，而且不會報任何錯。約束和觸發器要同一支一起上。
--
-- RLS 不用動，也不用補 GRANT。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.itinerary_entries drop constraint if exists quoted_entry_has_no_hours;

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
         -- 沒有這個記號的話，「使用者自己打的」和「引用被刪掉的」分不出來，
         -- 每一筆自由輸入的項目都會被誤標成「原項目已刪除」
         detached_at = now(),
         updated_at  = now()
   where item_id = old.id;
  return old;
end $$;

commit;

-- 驗證：約束已經不在（應該回 0 筆）
select conname from pg_constraint
where conrelid = 'public.itinerary_entries'::regclass
  and conname = 'quoted_entry_has_no_hours';

-- 驗證：觸發器的函式確實會留下營業時間快照
select position('coalesce(closed_day, old.closed_day)' in prosrc) > 0 as 斷開時保留公休日,
       position('else old.hours end' in prosrc) > 0                  as 斷開時保留營業時間
from pg_proc where proname = 'detach_itinerary_on_item_delete';

-- 既有資料：引用列目前應該都還是空的（前端還沒開始寫）
select count(*) filter (where item_id is not null and hours <> '[]'::jsonb)  as 引用列有營業時間,
       count(*) filter (where item_id is not null and closed_day is not null) as 引用列有公休日
from public.itinerary_entries;
