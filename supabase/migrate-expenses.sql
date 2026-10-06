-- 記帳（v2.2.0）：兩張新表、RLS、一支 RPC。
--
-- 兩種帳混在 expenses 一張表，靠 kind 分：
--   group    全員共用，payer_id 記誰先付，分攤在 expense_shares
--   personal 只有本人看得到
-- 合在一起是因為「把共同帳的自己那份複製進個人帳」如果跨兩張表就變成搬運，
-- 而兩邊欄位其實一模一樣。不合法的組合用 CHECK 擋。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- ---------- 資料表 ----------

create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips on delete cascade,
  kind              text not null check (kind in ('personal', 'group')),
  title             text not null check (char_length(title) between 1 and 100),
  amount            numeric(12,2) not null check (amount > 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  date              date not null,
  note              text not null default '' check (char_length(note) <= 500),
  payer_id          uuid references public.profiles on delete set null,
  owner_user_id     uuid references public.profiles on delete cascade,
  source_expense_id uuid references public.expenses on delete set null,
  created_by        uuid not null references public.profiles on delete cascade,
  updated_by        uuid references public.profiles on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expense_kind_shape check (
    (kind = 'group'    and payer_id is not null and owner_user_id is null and source_expense_id is null)
    or
    (kind = 'personal' and owner_user_id is not null and payer_id is null)
  )
);

create table if not exists public.expense_shares (
  expense_id uuid not null references public.expenses on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  settled    boolean not null default false,
  primary key (expense_id, user_id)
);

create index if not exists expenses_trip_idx       on public.expenses (trip_id, kind, date);
create index if not exists expenses_owner_idx      on public.expenses (trip_id, owner_user_id);
create index if not exists expense_shares_user_idx on public.expense_shares (user_id);

-- ---------- 觸發器 ----------

create or replace function public.stamp_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses
  for each row execute function public.stamp_expense();

-- ---------- 權限判斷函式 ----------

create or replace function public.can_touch_expense(p_kind text, p_trip uuid, p_owner uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select case when p_kind = 'group'
              then public.is_trip_member(p_trip)
              else p_owner = auth.uid() end;
$$;

-- security definer：policy 裡直接子查詢 expenses 會再套一次 expenses 的 policy，
-- 兩張表互相引用就遞迴了。
create or replace function public.can_touch_share(e uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.expenses x
    where x.id = e and x.kind = 'group' and public.is_trip_member(x.trip_id)
  );
$$;

-- ---------- RLS ----------

alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('expenses', 'expense_shares')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy expenses_select on public.expenses for select
  using (public.can_touch_expense(kind, trip_id, owner_user_id));
create policy expenses_insert on public.expenses for insert
  with check (
    public.is_trip_member(trip_id)
    and created_by = auth.uid()
    and (kind = 'group' or owner_user_id = auth.uid())
  );
create policy expenses_update on public.expenses for update
  using (public.can_touch_expense(kind, trip_id, owner_user_id))
  with check (public.can_touch_expense(kind, trip_id, owner_user_id));
create policy expenses_delete on public.expenses for delete
  using (public.can_touch_expense(kind, trip_id, owner_user_id));

-- update 開給全員是刻意的：settled 任何成員都能勾，不是只有當事人
create policy expense_shares_select on public.expense_shares for select
  using (public.can_touch_share(expense_id));
create policy expense_shares_insert on public.expense_shares for insert
  with check (public.can_touch_share(expense_id));
create policy expense_shares_update on public.expense_shares for update
  using (public.can_touch_share(expense_id)) with check (public.can_touch_share(expense_id));
create policy expense_shares_delete on public.expense_shares for delete
  using (public.can_touch_share(expense_id));

-- ---------- RPC ----------
-- 帳目與分攤一定要同一筆交易。只寫進帳目、分攤失敗的話，這筆錢在畫面上
-- 就是「沒有人要付」，而且看不出哪裡壞掉。
--
-- security invoker（預設）：寫入照樣走上面的 policy，權限只有一個來源。
-- 下面的檢查是為了給得出看得懂的錯誤訊息，以及擋住 RLS 管不到的規則。
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

  select sum((s ->> 'amount')::numeric) into v_total from jsonb_array_elements(p_shares) s;
  if v_total is distinct from v_amount then
    raise exception 'shares_total_mismatch: 分攤加總 % 不等於總額 %', v_total, v_amount;
  end if;

  -- 不限 active：已經離開的人舊帳裡還會出現，擋掉的話那些帳就再也編輯不了（§3.3）
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

  insert into public.expenses
    (id, trip_id, kind, title, amount, currency, date, note, payer_id, created_by)
  values (
    v_id, v_trip, 'group',
    p_expense ->> 'title', v_amount, p_expense ->> 'currency',
    (p_expense ->> 'date')::date, coalesce(p_expense ->> 'note', ''),
    v_payer, auth.uid())
  on conflict (id) do update set
    title    = excluded.title,
    amount   = excluded.amount,
    currency = excluded.currency,
    date     = excluded.date,
    note     = excluded.note,
    payer_id = excluded.payer_id;

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

-- 驗證：兩張表、八條 policy、一支 RPC
select tablename, count(*) as policies from pg_policies
where schemaname = 'public' and tablename in ('expenses', 'expense_shares')
group by tablename order by tablename;

select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('save_group_expense', 'can_touch_expense', 'can_touch_share', 'stamp_expense')
order by proname;
