-- ============================================================
-- 行前清單：資料表、RLS、RPC
-- 用法：整份貼進 Supabase 的 SQL Editor 執行。可以重複執行。
--
-- 與 PRD §4 的兩處刻意偏離：
--   1. ItemImage 沒有獨立資料表，改成 items.images 的 jsonb 陣列。
--      App 從來不會單獨查圖片，拆成兩張表只是多一次 join。
--   2. 連結同樣放 items.links jsonb，因為一個項目可以有多個命名連結。
-- ============================================================

-- ---------- 1. 資料表 ----------

-- 帳號密碼登入，不收 email。Supabase Auth 底層仍需要 email 格式，
-- 前端把帳號接上固定假網域（<帳號>@pretravel.app），使用者看不到也不用輸入。
-- 網域必須是合法 TLD，實測 .local 會被 Supabase 判定為無效 email。
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);
-- 舊版跑過的話把 email 欄拿掉，這裡沒有真的 email 可存
alter table public.profiles drop column if exists email;
alter table public.profiles add column if not exists username text;
-- username 存使用者打的原樣（Jean），小寫化只用在登入比對的 email 上。
-- 唯一性靠這個函式索引，所以 Jean 和 jean 仍然搶不到同一個帳號。
-- 注意：之後若要用帳號查詢，條件要寫 lower(username) = lower($1) 或 ilike，
-- 直接 eq 會變成大小寫敏感，索引也吃不到。
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 50),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  cover_path   text,
  -- v2.0：改為必填（Q9），行程的「天」是由起訖日自動產生的
  start_date   date not null,
  end_date     date not null,
  constraint trip_dates_ordered check (end_date >= start_date),
  owner_id     uuid not null references public.profiles on delete cascade,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id   uuid not null references public.trips on delete cascade,
  user_id   uuid not null references public.profiles on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  status    text not null default 'active' check (status in ('active', 'left')),
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (trip_id, user_id),
  -- PRD §3.2：擁有者不能自行離開專案，要先刪除專案
  constraint owner_cannot_leave check (not (role = 'owner' and status = 'left'))
);

create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips on delete cascade,
  token      text not null unique,
  created_by uuid not null references public.profiles on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  sort_order int not null default 0,
  unique (trip_id, name)
);

create table if not exists public.tags (
  id      uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  name    text not null check (char_length(name) between 1 and 20),
  unique (trip_id, user_id, name)
);

create table if not exists public.items (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips on delete cascade,
  -- v2.0：共同分頁移除（Q8，行程取代它），項目一定屬於某一個人的清單分頁
  owner_user_id   uuid not null references public.profiles on delete cascade,
  type            text not null check (type in ('place', 'shopping')),
  title           text not null check (char_length(title) between 1 and 100),
  region_id       uuid references public.regions on delete set null,
  links           jsonb not null default '[]'::jsonb,
  images          jsonb not null default '[]'::jsonb,
  note            text not null default '' check (char_length(note) <= 2000),
  visited         boolean not null default false,
  purchase_status text not null default 'todo' check (purchase_status in ('todo', 'bought', 'not_found')),
  planned_store   text not null default '' check (char_length(planned_store) <= 100),
  sort_order      int not null default 0,
  created_by      uuid not null references public.profiles on delete cascade,
  updated_by      uuid references public.profiles on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.item_tags (
  item_id uuid not null references public.items on delete cascade,
  tag_id  uuid not null references public.tags on delete cascade,
  primary key (item_id, tag_id)
);

-- ItineraryEntry（PRD §4.1）。行程是全隊共用一份，不分個人分頁，
-- 所以這張表沒有 owner_user_id，權限只看「是不是這個專案的 active 成員」。
create table if not exists public.itinerary_entries (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips on delete cascade,
  date           date not null,
  section        text not null check (section in ('schedule', 'meal')),
  slot           text not null,
  kind           text not null default 'place' check (kind in ('place', 'transport')),
  -- 引用不是複製（Q10）。項目被刪時不連鎖刪這一列，見下方 F-47 的觸發器。
  item_id        uuid references public.items on delete set null,
  -- F-47 斷開引用的時間。這個欄位是必要的，不是紀錄用途：
  -- 「使用者自己打的」和「引用被刪掉後斷開的」兩種資料長得一模一樣
  -- （item_id 都是 null、title 都有值），沒有這個記號前端分不出來，
  -- 每一筆自由輸入的項目都會被誤標成「原項目已刪除」。
  detached_at    timestamptz,
  title          text not null default '' check (char_length(title) <= 100),
  transport_mode text not null default '' check (char_length(transport_mode) <= 30),
  -- D8：純 TIME 不做時區換算。在台灣排、在日本看，用 timestamp 會整份差幾小時。
  start_time     time,
  end_time       time,
  note           text not null default '' check (char_length(note) <= 500),
  done           boolean not null default false,
  sort_order     int not null default 0,
  created_by     uuid not null references public.profiles on delete cascade,
  updated_by     uuid references public.profiles on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- slot 的合法值取決於 section（PRD §4.1）
  constraint slot_matches_section check (
    (section = 'schedule' and slot in ('morning', 'afternoon', 'evening'))
    or (section = 'meal' and slot in ('breakfast', 'lunch', 'snack', 'dinner', 'late_night'))
  ),
  -- 餐食區沒有交通類型（F-42）
  constraint meal_has_no_transport check (section <> 'meal' or kind = 'place'),
  -- 交通項目不引用清單地點（F-39）
  constraint transport_has_no_item check (kind <> 'transport' or item_id is null),
  -- 沒有引用就必須自己有標題（F-38）
  constraint title_or_item_required check (item_id is not null or char_length(btrim(title)) > 0),
  constraint end_after_start check (end_time is null or start_time is null or end_time >= start_time)
);

-- TripDay：只在真的寫備註時才會有資料列（PRD §4.1）
create table if not exists public.trip_days (
  trip_id    uuid not null references public.trips on delete cascade,
  date       date not null,
  note       text not null default '' check (char_length(note) <= 500),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (trip_id, date)
);
-- 已經建過表的資料庫也要補上這一欄（create table if not exists 不會改既有的表）
alter table public.itinerary_entries add column if not exists detached_at timestamptz;

create index if not exists items_trip_idx        on public.items (trip_id);
create index if not exists items_owner_idx       on public.items (trip_id, owner_user_id, type);
create index if not exists members_user_idx      on public.trip_members (user_id);
create index if not exists tags_trip_user_idx    on public.tags (trip_id, user_id);
create index if not exists regions_trip_idx      on public.regions (trip_id);
create index if not exists item_tags_tag_idx     on public.item_tags (tag_id);
-- PRD §4.1 建議的索引：打開某一天時就是照這個順序撈
create index if not exists itinerary_day_idx     on public.itinerary_entries (trip_id, date, section, slot, sort_order);
-- 反查「這個地點排在哪幾天」，F-41 的重複提示與 F-47 的刪除確認都要用
create index if not exists itinerary_item_idx    on public.itinerary_entries (item_id);

-- ---------- 2. 觸發器 ----------

-- 註冊時自動建 profile（F-01）。
-- 帳號取自註冊時帶的 metadata；若是直接在 Supabase 後台開的帳號就退回 email 的 @ 前段，
-- 這樣手動建帳號也會有合理的使用者名稱。
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    uname,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), uname),
    null
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

-- 項目另外蓋上「誰改的」，不靠前端自己填才不會被冒名
create or replace function public.stamp_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.stamp_item();

create or replace function public.stamp_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

drop trigger if exists itinerary_touch on public.itinerary_entries;
create trigger itinerary_touch before update on public.itinerary_entries
  for each row execute function public.stamp_entry();

-- F-47：刪掉被行程引用的地點時，行程項目要保留，只斷開引用並把標題留下來。
-- 這件事一定要在資料庫做，不能放前端：換一台裝置、或由另一個成員刪除時，
-- 前端那段根本不會執行，行程就會留著指向不存在項目的引用。
-- BEFORE DELETE 讓我們還讀得到 old.title；跑完之後 FK 的 set null 已經無事可做。
create or replace function public.detach_itinerary_on_item_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.itinerary_entries
     set item_id = null,
         -- 引用中的 entry 標題本來是空的，填入被刪項目的標題當快照
         title   = case when btrim(title) <> '' then title else old.title end,
         -- 沒有這個記號的話，「使用者自己打的」和「引用被刪掉的」分不出來，
         -- 每一筆自由輸入的項目都會被誤標成「原項目已刪除」
         detached_at = now(),
         updated_at  = now()
   where item_id = old.id;
  return old;
end $$;

drop trigger if exists items_detach_itinerary on public.items;
create trigger items_detach_itinerary before delete on public.items
  for each row execute function public.detach_itinerary_on_item_delete();

-- D1：勾選行程項目的「完成」時，若引用的是勾選者自己的地點就同步寫回 visited；
-- 引用他人的地點只更新行程的 done，不動對方的資料。
-- 這裡的 where 條件就是那條規則本身，影響 0 筆正是「別人的項目」的預期結果，
-- 跟其他地方「0 筆代表被拒絕」的判讀不同，不要在這裡加 must() 之類的檢查。
create or replace function public.sync_visited_on_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.done is distinct from old.done and new.item_id is not null then
    update public.items
       set visited = new.done
     where id = new.item_id
       and owner_user_id = auth.uid()
       and type = 'place';
  end if;
  return new;
end $$;

drop trigger if exists itinerary_sync_visited on public.itinerary_entries;
create trigger itinerary_sync_visited after update on public.itinerary_entries
  for each row execute function public.sync_visited_on_done();

-- ---------- 3. 權限判斷函式 ----------
-- 全部 security definer：它們自己讀表時繞過 RLS，否則 policy 互相引用會無限遞迴。

create or replace function public.is_trip_member(t uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = t and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_trip_owner(t uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = t and user_id = auth.uid() and status = 'active' and role = 'owner'
  );
$$;

-- 沒有 status 過濾：已離開成員的名字與頭像還是要看得到（§3.3 分頁保留）
create or replace function public.shares_trip_with(u uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.trip_members a
    join public.trip_members b on b.trip_id = a.trip_id
    where a.user_id = auth.uid() and b.user_id = u
  );
$$;

create or replace function public.member_has_left(t uuid, u uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select u is not null and exists (
    select 1 from public.trip_members
    where trip_id = t and user_id = u and status = 'left'
  );
$$;

-- 可寫 = 專案成員，而且項目在共同分頁或自己的分頁（§3.2 他人分頁唯讀）
create or replace function public.can_edit_item(i uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.items it
    where it.id = i
      and public.is_trip_member(it.trip_id)
      and it.owner_user_id = auth.uid()
  );
$$;

-- ---------- 4. RLS ----------

alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;
alter table public.invites      enable row level security;
alter table public.regions      enable row level security;
alter table public.tags         enable row level security;
alter table public.items        enable row level security;
alter table public.item_tags    enable row level security;
alter table public.itinerary_entries enable row level security;
alter table public.trip_days         enable row level security;

-- 讓整份檔案可以重跑：先清掉既有 policy
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','trips','trip_members','invites','regions','tags','items','item_tags','itinerary_entries','trip_days')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles：自己，加上同專案的人
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- trips：成員可讀，只有擁有者能改（含軟刪除）
create policy trips_select on public.trips for select
  using (deleted_at is null and public.is_trip_member(id));
create policy trips_update on public.trips for update
  using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));
-- 沒有 insert policy：新增專案一律走 create_trip()，才能同時寫入擁有者的成員資格

-- trip_members：成員互相看得到；擁有者可移除他人，成員可移除自己
create policy members_select on public.trip_members for select
  using (public.is_trip_member(trip_id));
create policy members_update on public.trip_members for update
  using (public.is_trip_owner(trip_id) or user_id = auth.uid())
  with check (public.is_trip_owner(trip_id) or user_id = auth.uid());
-- §3.3：擁有者可以刪掉已離開成員的分頁，但不能直接踢掉還在的人（那是 status 改成 left）
create policy members_delete on public.trip_members for delete
  using (public.is_trip_owner(trip_id) and status = 'left');
-- 沒有 insert policy：加入專案一律走 accept_invite()

-- invites：任何成員都能產生（§3.2 Q3）；撤銷限擁有者或自己產生的
create policy invites_select on public.invites for select
  using (public.is_trip_member(trip_id));
create policy invites_insert on public.invites for insert
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
create policy invites_update on public.invites for update
  using (public.is_trip_owner(trip_id) or created_by = auth.uid())
  with check (public.is_trip_owner(trip_id) or created_by = auth.uid());

-- regions：所有成員都能增刪改排序
create policy regions_all on public.regions for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- tags：只有自己的，別人的標籤連看都看不到（F-22）
create policy tags_all on public.tags for all
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

-- items：成員全部可讀；寫入限共同分頁或自己的分頁
create policy items_select on public.items for select
  using (public.is_trip_member(trip_id));
create policy items_insert on public.items for insert
  with check (
    public.is_trip_member(trip_id)
    and created_by = auth.uid()
    and owner_user_id = auth.uid()
  );
create policy items_update on public.items for update
  using (public.is_trip_member(trip_id) and owner_user_id = auth.uid())
  with check (public.is_trip_member(trip_id) and owner_user_id = auth.uid());
-- Q2：共同分頁的項目任何成員都可刪。
-- 第二條是 §3.3：擁有者可以刪掉已離開成員分頁裡的項目。
create policy items_delete on public.items for delete
  using (
    (public.is_trip_member(trip_id) and owner_user_id = auth.uid())
    or (public.is_trip_owner(trip_id) and public.member_has_left(trip_id, owner_user_id))
  );

-- item_tags：只能貼自己的標籤，而且只能貼在可寫的項目上（§4.2）
create policy item_tags_select on public.item_tags for select
  using (exists (
    select 1 from public.items it
    where it.id = item_tags.item_id and public.is_trip_member(it.trip_id)
  ));
create policy item_tags_insert on public.item_tags for insert
  with check (
    public.can_edit_item(item_tags.item_id)
    and exists (select 1 from public.tags g where g.id = item_tags.tag_id and g.user_id = auth.uid())
  );
create policy item_tags_delete on public.item_tags for delete
  using (
    public.can_edit_item(item_tags.item_id)
    and exists (select 1 from public.tags g where g.id = item_tags.tag_id and g.user_id = auth.uid())
  );

-- 行程：全隊共用一份，任何 active 成員都能增刪改（§3.2）。
-- 刻意不設個人隔離，行程的價值就在於大家看同一份。
create policy itinerary_select on public.itinerary_entries for select
  using (public.is_trip_member(trip_id));
create policy itinerary_insert on public.itinerary_entries for insert
  with check (public.is_trip_member(trip_id) and created_by = auth.uid());
create policy itinerary_update on public.itinerary_entries for update
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy itinerary_delete on public.itinerary_entries for delete
  using (public.is_trip_member(trip_id));

create policy trip_days_all on public.trip_days for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- ---------- 5. RPC ----------

-- F-03：建專案與寫入擁有者成員資格必須同一筆交易，否則中斷時會出現沒有成員的孤兒專案
create or replace function public.create_trip(
  p_name text, p_country text, p_start date, p_end date, p_cover text
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- v2.0：日期必填。少了它行程頁連「有哪幾天」都算不出來，
  -- 這裡明確擋掉，不要讓前端拿到一句難懂的 not-null violation。
  if p_start is null or p_end is null then raise exception 'dates_required'; end if;
  if p_end < p_start then raise exception 'end_before_start'; end if;
  insert into public.trips (name, country_code, start_date, end_date, cover_path, owner_id)
  values (trim(p_name), upper(p_country), p_start, p_end, nullif(p_cover, ''), auth.uid())
  returning id into new_id;
  insert into public.trip_members (trip_id, user_id, role, status)
  values (new_id, auth.uid(), 'owner', 'active');
  return new_id;
end $$;

-- F-04：軟刪除必須走 RPC，不能讓前端直接 update trips set deleted_at。
-- 原因是 PostgreSQL 對 UPDATE 會把 SELECT 政策的條件「同時套用在新列上」，
-- 而 trips_select 含 deleted_at is null，所以一設 deleted_at 新列就不符合自己的讀取政策，
-- 整句會被擋成 new row violates row-level security policy。
-- security definer 繞過 RLS，擁有者檢查改在函式裡自己做。
create or replace function public.delete_trip(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_owner(p_trip_id) then
    raise exception 'not_owner';
  end if;
  update public.trips set deleted_at = now() where id = p_trip_id and deleted_at is null;
end $$;

-- F-06：邀請頁在加入之前還不是成員，讀不到 trips / profiles，所以用 RPC 回傳需要顯示的部分
create or replace function public.invite_preview(p_token text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'valid',   i.revoked_at is null and i.expires_at > now() and t.deleted_at is null,
    'tripId',  t.id,
    'name',    t.name,
    'country', t.country_code,
    'inviter', jsonb_build_object('name', p.display_name, 'avatar', p.avatar_url),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', mp.display_name, 'avatar', mp.avatar_url) order by m.joined_at)
      from public.trip_members m
      join public.profiles mp on mp.id = m.user_id
      where m.trip_id = t.id and m.status = 'active'
    ), '[]'::jsonb),
    'joined', exists (
      select 1 from public.trip_members m
      where m.trip_id = t.id and m.user_id = auth.uid() and m.status = 'active'
    )
  )
  from public.invites i
  join public.trips t    on t.id = i.trip_id
  join public.profiles p on p.id = i.created_by
  where i.token = p_token;
$$;

-- token 查不到時回傳 null，前端一律當作失效處理
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select i.trip_id, i.revoked_at, i.expires_at, t.deleted_at into inv
  from public.invites i join public.trips t on t.id = i.trip_id
  where i.token = p_token;
  if not found or inv.revoked_at is not null or inv.expires_at <= now() or inv.deleted_at is not null then
    raise exception 'invite_invalid';
  end if;
  -- 曾經離開又被邀請回來：恢復成 active，原本的 role 保留（§3.3）
  insert into public.trip_members (trip_id, user_id, role, status)
  values (inv.trip_id, auth.uid(), 'member', 'active')
  on conflict (trip_id, user_id) do update set status = 'active', left_at = null;
  return inv.trip_id;
end $$;

-- ---------- 6. Storage ----------
-- media：私有，路徑第一段是 trip_id，用它判斷成員資格
-- avatars：公開讀，只能寫自己的資料夾

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 1048576)
on conflict (id) do update set public = true, file_size_limit = 1048576;

-- 路徑第一段不是合法 uuid 時 cast 會丟例外，用 exception 收掉當作拒絕
create or replace function public.storage_trip_ok(object_name text)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare t uuid;
begin
  t := (storage.foldername(object_name))[1]::uuid;
  return public.is_trip_member(t);
exception when others then
  return false;
end $$;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'pretravel_%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy pretravel_media_read on storage.objects for select
  using (bucket_id = 'media' and public.storage_trip_ok(name));
create policy pretravel_media_write on storage.objects for insert
  with check (bucket_id = 'media' and public.storage_trip_ok(name));
create policy pretravel_media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.storage_trip_ok(name));

create policy pretravel_avatar_read on storage.objects for select
  using (bucket_id = 'avatars');
create policy pretravel_avatar_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pretravel_avatar_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pretravel_avatar_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
