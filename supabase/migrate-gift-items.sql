-- 第四種子清單「送禮」（v2.6.0），而且只有本人看得到。
--
-- 欄位跟購物完全一樣（title 當「送給誰」，加 links / images / planned_store /
-- note / purchase_status），沒有新欄位，只放寬 type 的 CHECK。
--
-- 可見性是這支的重點：同行的人可能就是收禮對象，所以 gift 不跟著其他三種的
-- 「成員互相看得到」。判斷抽成 item_visible()，因為 items 和 item_tags 兩邊
-- 都要用同一句話 —— 只改 items 那邊的話，別人至少能從標籤關聯看出「A 有一個
-- 標著某某的東西」，而標籤名稱本身（「給媽媽」之類）就足以破梗。
--
-- 寫入權限不用動：items_update / items_delete 本來就要求 owner_user_id =
-- auth.uid()，gift 自動沿用。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.items drop constraint if exists items_type_check;
alter table public.items add constraint items_type_check
  check (type in ('place', 'shopping', 'reference', 'gift'));

create or replace function public.item_visible(p_type text, p_trip uuid, p_owner uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_trip_member(p_trip)
     and (p_type <> 'gift' or p_owner = auth.uid());
$$;

drop policy if exists items_select on public.items;
create policy items_select on public.items for select
  using (public.item_visible(type, trip_id, owner_user_id));

drop policy if exists item_tags_select on public.item_tags;
create policy item_tags_select on public.item_tags for select
  using (exists (
    select 1 from public.items it
    where it.id = item_tags.item_id
      and public.item_visible(it.type, it.trip_id, it.owner_user_id)
  ));

commit;

-- 驗證：type 約束含 gift，兩條 select 政策都走 item_visible
select pg_get_constraintdef(oid) as items_type_check
from pg_constraint
where conrelid = 'public.items'::regclass and conname = 'items_type_check';

select tablename, policyname, qual
from pg_policies
where schemaname = 'public' and policyname in ('items_select', 'item_tags_select')
order by tablename;
