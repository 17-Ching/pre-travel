-- 記帳分類（v2.12.0）：餐飲、交通、住宿、購物、門票娛樂、其他。
-- 固定這六個值不給使用者自訂，既有的帳吃 default 'other'，不用回填。
--
-- 這支不只加欄位，還要換掉 save_group_expense ——
-- 共同帳是走那支 RPC 存的，RPC 的 upsert 沒把 category 寫進去的話，共同帳的
-- 類別會永遠停在 'other'，而且不會報任何錯：畫面看起來正常、統計永遠是錯的。
-- 這種沉默的錯比壞掉還難查，所以欄位和 RPC 一定要同一支 migration 一起上。
-- 個人帳是前端直接 insert / update，不經過這支。
--
-- 10/30 的授權變更不影響這支：那條規則是針對「新建的資料表」，這裡只是加欄位，
-- GRANT 是表層級的，既有授權自動涵蓋新欄位。RPC 是 create or replace，
-- 既有的 execute 權限也跟著留著。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.expenses add column if not exists category text not null default 'other';
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('food', 'transport', 'stay', 'shopping', 'fun', 'other'));

create or replace function public.save_group_expense(p_expense jsonb, p_shares jsonb)
returns void language plpgsql set search_path = public as $$
declare
  v_id     uuid    := (p_expense ->> 'id')::uuid;
  v_trip   uuid    := (p_expense ->> 'trip_id')::uuid;
  v_amount numeric := (p_expense ->> 'amount')::numeric;
  v_payer  uuid    := (p_expense ->> 'payer_id')::uuid;
  v_total  numeric;
begin
  if not public.is_trip_member(v_trip) then raise exception 'not_member'; end if;
  if p_shares is null or jsonb_array_length(p_shares) = 0 then
    raise exception 'shares_required';
  end if;

  -- 加總必須剛好等於總額。差一塊錢就代表有人的份沒算進去，寧可擋下來讓使用者改，
  -- 也不要默默存成一筆對不起來的帳 —— 那種錯誤要等分帳時才會被發現。
  select sum((s ->> 'amount')::numeric) into v_total from jsonb_array_elements(p_shares) s;
  if v_total is distinct from v_amount then
    raise exception 'shares_total_mismatch: 分攤加總 % 不等於總額 %', v_total, v_amount;
  end if;

  -- 付款人與每個被分攤的人都要在這個專案裡。不限 active：已經離開的人
  -- 舊帳裡還會出現，擋掉的話那些帳就再也編輯不了（§3.3）。
  if not exists (select 1 from public.trip_members
                 where trip_id = v_trip and user_id = v_payer) then
    raise exception 'payer_not_member';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) s
    where not exists (
      select 1 from public.trip_members m
      where m.trip_id = v_trip and m.user_id = (s ->> 'user_id')::uuid)
  ) then
    raise exception 'share_user_not_member';
  end if;

  -- category 一定要跟著 insert 與 update 一起寫（v2.12.0）。少寫的話共同帳的類別
  -- 會永遠停在 default 'other'，而且不會報錯 —— 畫面看起來正常，統計卻永遠是錯的。
  insert into public.expenses
    (id, trip_id, kind, title, amount, currency, date, note, category, payer_id, created_by)
  values (
    v_id, v_trip, 'group',
    p_expense ->> 'title', v_amount, p_expense ->> 'currency',
    (p_expense ->> 'date')::date, coalesce(p_expense ->> 'note', ''),
    coalesce(p_expense ->> 'category', 'other'),
    v_payer, auth.uid())
  on conflict (id) do update set
    title    = excluded.title,
    amount   = excluded.amount,
    currency = excluded.currency,
    date     = excluded.date,
    note     = excluded.note,
    category = excluded.category,
    payer_id = excluded.payer_id;
    -- updated_at / updated_by 由 expenses_touch 觸發器蓋，不靠呼叫端填

  -- 編輯時從名單上拿掉的人，分攤要跟著消失
  delete from public.expense_shares sh
  where sh.expense_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(p_shares) s
      where (s ->> 'user_id')::uuid = sh.user_id);

  insert into public.expense_shares (expense_id, user_id, amount, settled)
  select v_id, (s ->> 'user_id')::uuid, (s ->> 'amount')::numeric,
         coalesce((s ->> 'settled')::boolean, false)
  from jsonb_array_elements(p_shares) s
  on conflict (expense_id, user_id) do update set
    amount  = excluded.amount,
    settled = excluded.settled;
end $$;

commit;

-- 驗證：欄位在、約束含六個值、RPC 的內文確實寫了 category
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'expenses' and column_name = 'category';

select pg_get_constraintdef(oid) as expenses_category_check
from pg_constraint
where conrelid = 'public.expenses'::regclass and conname = 'expenses_category_check';

select position('category = excluded.category' in prosrc) > 0 as rpc_updates_category
from pg_proc where proname = 'save_group_expense';

select category, count(*) from public.expenses group by category order by category;
