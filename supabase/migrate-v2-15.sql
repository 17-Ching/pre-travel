-- v2.15.0：行李清單（packing_nodes、packing_lists）。
--
-- 每個人在每趟有自己的一份，連同行成員都看不到 —— 整張表只有本人，
-- 不是靠 policy 在共用表裡挑。
--
-- ⚠ 這是 2026-10-30 之後第一支「建新表」的 migration，所以**一定要自己附 GRANT**。
-- Supabase 不再自動把 public schema 的新表授權給 Data API 角色，漏了的話
-- 前端會拿到 42501 permission denied for table packing_nodes —— 而且是在 RLS
-- 之前就被 PostgREST 擋掉，policy 寫得再對也沒用。見 API-HANDOFF 第 4 節。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- ── 1. 資料表 ────────────────────────────────────────────────
-- 樹狀用 parent_id 自我參照，不用 ltree 或路徑字串：前端限 3 層，整趟幾十筆，
-- 一次全撈回去在記憶體裡組樹就好。on delete cascade 讓刪群組自動帶走子孫。
create table if not exists public.packing_nodes (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips on delete cascade,
  owner_user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  -- null = 最外層。父子關係的三個一致性條件（父必須是群組、同一趟、同一人）
  -- 靠觸發器擋，不是 FK —— FK 只保證「指到一個存在的節點」。
  parent_id     uuid references public.packing_nodes on delete cascade,
  kind          text not null check (kind in ('group', 'item')),
  title         text not null check (char_length(btrim(title)) between 1 and 100),
  -- 只有 item 用得到。group 一律 null / false，靠下面的 CHECK 擋，
  -- 不然「群組上的數量」會是一個永遠不顯示、卻會被複製來複製去的幽靈值。
  qty           int check (qty between 1 and 99),
  packed        boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint packing_group_has_no_qty check (kind = 'item' or (qty is null and packed = false)),
  -- 自己不能是自己的父節點。更長的環（A→B→A）這裡擋不掉，
  -- 但那要前端刻意送出才會發生，而且不會讓資料外洩，不值得為它加遞迴檢查。
  constraint packing_no_self_parent check (parent_id is null or parent_id <> id)
);

-- 「這個人在這趟已經初始化過預設清單」的記號。沒有它的話，使用者把清單刪光、
-- 重新進頁面就會又被塞回一份預設 —— 刪不掉的清單。
-- 主鍵同時擋住兩台裝置同時初始化塞兩份（init_packing 靠 on conflict do nothing 判斷）。
create table if not exists public.packing_lists (
  trip_id    uuid not null references public.trips on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index if not exists packing_owner_idx  on public.packing_nodes (owner_user_id, trip_id, sort_order);
create index if not exists packing_parent_idx on public.packing_nodes (parent_id);

-- ── 2. 父子一致性觸發器 ──────────────────────────────────────
create or replace function public.check_packing_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  select kind, trip_id, owner_user_id into p
  from public.packing_nodes where id = new.parent_id;
  if not found then raise exception 'packing_parent_not_found'; end if;
  if p.kind <> 'group' then raise exception 'packing_parent_not_group'; end if;
  if p.trip_id <> new.trip_id then raise exception 'packing_parent_other_trip'; end if;
  if p.owner_user_id <> new.owner_user_id then raise exception 'packing_parent_other_owner'; end if;
  return new;
end $$;

drop trigger if exists packing_nodes_parent_check on public.packing_nodes;
create trigger packing_nodes_parent_check before insert or update on public.packing_nodes
  for each row execute function public.check_packing_parent();

drop trigger if exists packing_nodes_touch on public.packing_nodes;
create trigger packing_nodes_touch before update on public.packing_nodes
  for each row execute function public.touch_updated_at();

-- ── 3. RLS ───────────────────────────────────────────────────
alter table public.packing_nodes enable row level security;
alter table public.packing_lists enable row level security;

drop policy if exists packing_nodes_all on public.packing_nodes;
drop policy if exists packing_lists_all on public.packing_lists;

-- 除了 owner 還要 is_trip_member：離開專案之後行李就讀不到了。這跟個人帳
-- （離開後仍讀得到自己的舊帳）不一樣，是刻意的 —— 舊帳是「誰欠誰錢」要對帳，
-- 行李是這趟的待辦，沒去就沒意義。
create policy packing_nodes_all on public.packing_nodes for all
  using (owner_user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (owner_user_id = auth.uid() and public.is_trip_member(trip_id));
create policy packing_lists_all on public.packing_lists for all
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

-- ── 4. RPC ───────────────────────────────────────────────────
create or replace function public.insert_packing_nodes(p_trip uuid, p_nodes jsonb)
returns void language plpgsql set search_path = public as $$
declare n jsonb;
begin
  for n in select value from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) loop
    insert into public.packing_nodes
      (id, trip_id, owner_user_id, parent_id, kind, title, qty, packed, sort_order)
    values (
      coalesce((n ->> 'id')::uuid, gen_random_uuid()),
      p_trip, auth.uid(),
      (n ->> 'parent_id')::uuid,
      n ->> 'kind',
      n ->> 'title',
      -- 群組不留數量：前端送了也丟掉，不然那個值會一路被複製下去
      case when n ->> 'kind' = 'item' then (n ->> 'qty')::int end,
      false,
      coalesce((n ->> 'sort_order')::int, 0));
  end loop;
end $$;

create or replace function public.init_packing(p_trip uuid, p_nodes jsonb)
returns setof public.packing_nodes language plpgsql set search_path = public as $$
declare v_fresh int;
begin
  insert into public.packing_lists (trip_id, user_id)
  values (p_trip, auth.uid())
  on conflict do nothing;
  get diagnostics v_fresh = row_count;

  if v_fresh > 0 then
    perform public.insert_packing_nodes(p_trip, p_nodes);
  end if;

  -- 兩種情況都回傳現況：剛初始化的回新的，已經有的回他自己的，
  -- 前端不用分兩條路處理。
  return query
    select * from public.packing_nodes
    where trip_id = p_trip and owner_user_id = auth.uid()
    order by sort_order, created_at;
end $$;

create or replace function public.replace_packing(p_trip uuid, p_nodes jsonb)
returns setof public.packing_nodes language plpgsql set search_path = public as $$
begin
  -- 只刪最外層，子孫靠 on delete cascade。先刪完再插，因為新舊可能用到同一批 id。
  delete from public.packing_nodes
  where trip_id = p_trip and owner_user_id = auth.uid() and parent_id is null;
  -- 保險：萬一有孤兒（父節點被刪但 cascade 沒涵蓋到的情況）也一起清掉
  delete from public.packing_nodes
  where trip_id = p_trip and owner_user_id = auth.uid();

  perform public.insert_packing_nodes(p_trip, p_nodes);

  -- 取代之後也算初始化過，不然下次進頁面又會被塞一份預設
  insert into public.packing_lists (trip_id, user_id)
  values (p_trip, auth.uid())
  on conflict do nothing;

  return query
    select * from public.packing_nodes
    where trip_id = p_trip and owner_user_id = auth.uid()
    order by sort_order, created_at;
end $$;

-- ── 5. Data API 授權（新表一定要）────────────────────────────
-- 不給 anon：全站都要登入，anon 從來不查表。
-- service_role 要給：npm run sweep 之類的維運腳本用的是它。
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.packing_nodes to authenticated, service_role;
grant select, insert, update, delete on public.packing_lists to authenticated, service_role;
grant execute on function public.insert_packing_nodes(uuid, jsonb) to authenticated, service_role;
grant execute on function public.init_packing(uuid, jsonb)         to authenticated, service_role;
grant execute on function public.replace_packing(uuid, jsonb)      to authenticated, service_role;

commit;

-- 驗證：兩張表都在、RLS 都開著
select relname as 資料表, relrowsecurity as RLS已開
from pg_class where relname in ('packing_nodes', 'packing_lists') order by relname;

-- 驗證：authenticated 真的拿得到四個權限（漏了就是 42501）
select table_name as 資料表, string_agg(privilege_type, ', ' order by privilege_type) as 權限
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and table_name in ('packing_nodes', 'packing_lists')
group by table_name order by table_name;

-- 驗證：三支函式都在
select proname as 函式 from pg_proc
where proname in ('check_packing_parent', 'insert_packing_nodes', 'init_packing', 'replace_packing')
order by proname;
