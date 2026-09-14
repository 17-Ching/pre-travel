-- RLS 權限驗證。跑在「用完就丟」的本機 Postgres，不要對正式資料庫執行。
--
--   psql -f supabase/rls-test.sql
--
-- 它會先補上 Supabase 專有的 auth / storage 物件，再載入 schema.sql，
-- 然後以兩個不同使用者的身分實際讀寫，確認 PRD §3.2 的權限矩陣真的擋得住。
-- 這裡驗的是資料庫這層，因為 PRD §7 寫明「前端隱藏按鈕不算授權」。

\set ON_ERROR_STOP on

-- ── 每次都從乾淨狀態開始，重跑才不會被上一輪的資料干擾 ──────
drop schema if exists auth cascade;
drop schema if exists storage cascade;
drop schema if exists public cascade;
create schema public;
create schema auth;
create schema storage;

create table auth.users (
  id                  uuid primary key,
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

-- 正式環境由 JWT 提供，這裡用連線層級的變數模擬「現在是誰」
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid;
$$;

create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

-- 角色是叢集層級的，重跑時不會被 drop schema 清掉
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

-- ── 受測對象 ────────────────────────────────────────────────
\ir schema.sql

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ── 測試工具 ────────────────────────────────────────────────
create or replace function ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice '  PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- 預期被擋下的寫入。RLS 有兩種擋法，兩種都算通過：
--   INSERT 違反 with check  → 丟錯誤
--   UPDATE / DELETE 不符 using → 不丟錯誤，只是靜默地影響 0 筆
-- 第二種很容易誤判成「政策沒生效」，所以這裡改看實際影響筆數。
-- 同一件事在前端也成立：更新回傳 0 筆就是被拒絕，不能當成功處理。
create or replace function denied(stmt text, label text) returns void language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n > 0 then
    raise exception 'FAIL  % （應該被擋，卻影響了 % 筆）', label, n;
  end if;
  raise notice '  PASS  %（RLS 濾掉，影響 0 筆）', label;
exception
  when insufficient_privilege or check_violation then
    raise notice '  PASS  %（政策拒絕）', label;
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice '  PASS  %（%）', label, sqlerrm;
end $$;

\set jean '11111111-1111-1111-1111-111111111111'
\set ruby '22222222-2222-2222-2222-222222222222'
\set kai  '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'jean', 'jean@pretravel.local', '{"username":"Jean"}'),
  (:'ruby', 'ruby@pretravel.local', '{"username":"Ruby","display_name":"Ruby W"}'),
  (:'kai',  'kai@pretravel.local',  '{"username":"kai"}');

-- 觸發器：帳號大小寫原樣保留，顯示名稱留空時繼承帳號
do $$ begin
  perform ok((select username from profiles where id = '11111111-1111-1111-1111-111111111111') = 'Jean',
    '帳號保留原樣大小寫（Jean 不會變成 jean）');
  perform ok((select display_name from profiles where id = '11111111-1111-1111-1111-111111111111') = 'Jean',
    '顯示名稱留空時繼承帳號');
  perform ok((select display_name from profiles where id = '22222222-2222-2222-2222-222222222222') = 'Ruby W',
    '有填顯示名稱時用填的');
end $$;

set role authenticated;

-- ── Jean 建專案、邀 Ruby ────────────────────────────────────
set app.uid = '11111111-1111-1111-1111-111111111111';

select create_trip('2026 秋・日本', 'jp', '2026-11-12', '2026-11-19', null) as trip_id \gset
insert into regions (trip_id, name, sort_order) values (:'trip_id', '東京', 0);
insert into invites (trip_id, token, created_by)
  values (:'trip_id', 'tok-demo', '11111111-1111-1111-1111-111111111111');

do $$ begin
  perform ok((select count(*) from trips) = 1, 'create_trip 建立了專案');
  perform ok((select country_code from trips limit 1) = 'JP', '國家代碼自動轉大寫');
  perform ok((select role from trip_members limit 1) = 'owner', '建立者自動成為擁有者');
end $$;

-- Jean 的個人項目與自己的標籤。v2.0 起沒有共同分頁（Q8），項目一定有主人。
insert into items (trip_id, owner_user_id, type, title, created_by)
  values (:'trip_id', '11111111-1111-1111-1111-111111111111', 'place', '一蘭 新宿', '11111111-1111-1111-1111-111111111111');
insert into tags (trip_id, user_id, name)
  values (:'trip_id', '11111111-1111-1111-1111-111111111111', '拉麵');

-- ── 非成員：完全看不到 ──────────────────────────────────────
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform ok((select count(*) from trips) = 0,  '非成員看不到專案');
  perform ok((select count(*) from items) = 0,  '非成員看不到任何項目');
  perform ok((select count(*) from regions) = 0, '非成員看不到地區');
end $$;

select denied(
  format('insert into items (trip_id, owner_user_id, type, title, created_by) values (%L, %L, %L, %L, %L)',
         :'trip_id', '33333333-3333-3333-3333-333333333333', 'place', '非成員亂塞', '33333333-3333-3333-3333-333333333333'),
  '非成員不能寫入項目');

-- ── Ruby 用邀請連結加入 ─────────────────────────────────────
set app.uid = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform ok((invite_preview('tok-demo') ->> 'valid')::boolean, '邀請預覽：連結有效');
  perform ok(invite_preview('tok-demo') -> 'inviter' ->> 'name' = 'Jean', '邀請預覽：看得到邀請人');
  perform ok(invite_preview('沒這個token') is null, '邀請預覽：token 不存在回 null');
end $$;

select accept_invite('tok-demo') \gset accepted_
do $$ begin
  perform ok((select count(*) from trips) = 1, '加入後看得到專案');
  perform ok((select count(*) from items) = 1, '加入後看得到他人分頁的項目');
end $$;

-- ── 核心：他人分頁唯讀（F-11 / §3.2）────────────────────────
select id as jean_item from items where owner_user_id = :'jean' \gset

select denied(
  format('update items set title = %L where id = %L', '被 Ruby 改掉', :'jean_item'),
  'Ruby 不能改 Jean 個人分頁的項目');
select denied(
  format('delete from items where id = %L', :'jean_item'),
  'Ruby 不能刪 Jean 個人分頁的項目');
select denied(
  format('insert into items (trip_id, owner_user_id, type, title, created_by) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'jean', 'place', '冒名塞進 Jean 的分頁', :'ruby'),
  'Ruby 不能把項目塞進 Jean 的分頁');
select denied(
  format('insert into items (trip_id, owner_user_id, type, title, created_by) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'ruby', 'place', '偽造新增者', :'jean'),
  'created_by 不能冒用別人');

-- Ruby 自己的分頁可以正常寫，並確認修改者是由觸發器蓋的
insert into items (trip_id, owner_user_id, type, title, created_by)
  values (:'trip_id', :'ruby', 'shopping', '合利他命', :'ruby');
update items set title = '合利他命 EX Plus' where owner_user_id = :'ruby';
do $$ begin
  perform ok((select title from items where owner_user_id = '22222222-2222-2222-2222-222222222222') = '合利他命 EX Plus',
    'Ruby 可以改自己分頁的項目');
  perform ok((select updated_by from items where owner_user_id = '22222222-2222-2222-2222-222222222222') = '22222222-2222-2222-2222-222222222222',
    '觸發器蓋上真正的修改者，不靠前端自己填');
end $$;

-- ── 標籤只有自己看得到（F-22）────────────────────────────────
insert into tags (trip_id, user_id, name) values (:'trip_id', :'ruby', '拉麵');
do $$ begin
  perform ok((select count(*) from tags) = 1, 'Ruby 只看得到自己的標籤');
  perform ok((select count(*) from tags where name = '拉麵') = 1,
    '同名標籤各自獨立，不會互相覆蓋');
end $$;

select denied(
  format('insert into tags (trip_id, user_id, name) values (%L, %L, %L)', :'trip_id', :'jean', '冒名標籤'),
  '不能建立掛在別人名下的標籤');

-- 只能貼自己的標籤（§4.2）
select id as ruby_tag from tags where user_id = :'ruby' \gset
select id as ruby_item from items where owner_user_id = :'ruby' \gset
insert into item_tags (item_id, tag_id) values (:'ruby_item', :'ruby_tag');
do $$ begin
  perform ok((select count(*) from item_tags) = 1, '可以把自己的標籤貼到自己的項目');
end $$;

select denied(
  format('insert into item_tags (item_id, tag_id) values (%L, %L)', :'jean_item', :'ruby_tag'),
  '不能把標籤貼到他人分頁的項目');

-- ── 行程：全隊共用一份（§3.2、F-37 到 F-47）────────────────
set app.uid = '22222222-2222-2222-2222-222222222222';

-- Ruby 把 Jean 的地點排進行程（引用，F-41）
insert into itinerary_entries (trip_id, date, section, slot, kind, item_id, created_by)
  values (:'trip_id', '2026-11-13', 'schedule', 'afternoon', 'place', :'jean_item', :'ruby');
-- 自由輸入一筆交通（F-39）
insert into itinerary_entries (trip_id, date, section, slot, kind, title, transport_mode, start_time, created_by)
  values (:'trip_id', '2026-11-13', 'schedule', 'morning', 'transport', '新宿 → 鎌倉', 'JR 橫須賀線', '09:15', :'ruby');
-- 餐食備選（F-42）
insert into itinerary_entries (trip_id, date, section, slot, title, created_by)
  values (:'trip_id', '2026-11-13', 'meal', 'lunch', '隨便一間拉麵', :'ruby');
insert into trip_days (trip_id, date, note, updated_by)
  values (:'trip_id', '2026-11-13', '住新宿，記得帶傘', :'ruby');

do $$ begin
  perform ok((select count(*) from itinerary_entries) = 3, '成員可以新增行程項目（不分個人分頁）');
  perform ok((select count(*) from trip_days) = 1, '成員可以寫每日備註');
end $$;

-- slot 與 section 的組合限制（PRD §4.1）
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, title, created_by) values (%L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'lunch', '時段放錯', :'ruby'),
  'schedule 不能用餐別當 slot');
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, kind, title, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'meal', 'dinner', 'transport', '餐食區的交通', :'ruby'),
  '餐食區不能有交通類型');
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, kind, item_id, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'evening', 'transport', :'jean_item', :'ruby'),
  '交通項目不能引用清單地點');
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, created_by) values (%L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'evening', :'ruby'),
  '沒有引用就必須自己有標題');

-- D1：勾完成時只同步自己的地點
select id as ref_entry from itinerary_entries where item_id = :'jean_item' \gset
update itinerary_entries set done = true where id = :'ref_entry';
do $$ begin
  perform ok((select done from itinerary_entries where item_id is not null), '行程的完成狀態有更新');
  perform ok((select visited from items where id = (select item_id from itinerary_entries where item_id is not null)) = false,
    'D1：引用他人地點時不會動到對方的 visited');
end $$;

set app.uid = '11111111-1111-1111-1111-111111111111';
update itinerary_entries set done = false where id = :'ref_entry';
update itinerary_entries set done = true  where id = :'ref_entry';
do $$ begin
  perform ok((select visited from items where id = (select item_id from itinerary_entries where item_id is not null)) = true,
    'D1：引用自己的地點時會同步寫回 visited');
end $$;

-- F-47：刪掉被引用的地點，行程項目要保留並留下標題
set app.uid = '11111111-1111-1111-1111-111111111111';
delete from items where id = :'jean_item';
do $$ begin
  perform ok((select count(*) from itinerary_entries) = 3, 'F-47：刪地點不連鎖刪行程項目');
  perform ok((select count(*) from itinerary_entries where id = (select id from itinerary_entries where title = '一蘭 新宿')) = 1,
    'F-47：被刪項目的標題有留在行程上');
  perform ok((select item_id from itinerary_entries where title = '一蘭 新宿') is null,
    'F-47：引用已斷開');
  perform ok((select done from itinerary_entries where title = '一蘭 新宿') = true,
    'F-47：完成狀態保留');
  -- 「使用者自己打的」和「引用被刪掉後斷開的」資料形狀一模一樣，
  -- 沒有 detached_at 的話畫面會把每一筆自由輸入的項目都標成「原項目已刪除」
  perform ok((select detached_at from itinerary_entries where title = '一蘭 新宿') is not null,
    'F-47：斷開的項目有蓋上 detached_at');
  perform ok((select detached_at from itinerary_entries where title = '隨便一間拉麵') is null,
    'F-47：自由輸入的項目不會被誤標成已斷開');
  perform ok((select detached_at from itinerary_entries where title = '新宿 → 鎌倉') is null,
    'F-47：交通項目也不會被誤標');
end $$;

-- 非成員完全碰不到行程
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform ok((select count(*) from itinerary_entries) = 0, '非成員看不到行程');
  perform ok((select count(*) from trip_days) = 0, '非成員看不到每日備註');
end $$;
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, title, created_by) values (%L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'morning', '亂塞', :'kai'),
  '非成員不能寫入行程');

-- 交回 Ruby，下面幾段驗的是「一般成員能做什麼」
set app.uid = '22222222-2222-2222-2222-222222222222';

-- ── 專案設定只有擁有者能動（§3.2）───────────────────────────
select denied(
  format('update trips set name = %L where id = %L', 'Ruby 亂改名', :'trip_id'),
  '成員不能改專案名稱');
select denied(format('select delete_trip(%L)', :'trip_id'), '成員不能刪除專案');

-- 地區則是所有成員都能動
insert into regions (trip_id, name, sort_order) values (:'trip_id', '大阪', 1);
do $$ begin
  perform ok((select count(*) from regions) = 2, '一般成員可以新增地區');
end $$;

-- ── 離開與擁有者限制（§3.3）─────────────────────────────────
update trip_members set status = 'left', left_at = now() where user_id = :'ruby';
do $$ begin
  perform ok((select count(*) from trips) = 0, '離開後就看不到這個專案了');
end $$;

set app.uid = '11111111-1111-1111-1111-111111111111';
do $$
declare failed boolean := false;
begin
  begin
    update trip_members set status = 'left' where role = 'owner';
    failed := true;
  exception when check_violation then null;
  end;
  perform ok(not failed, '擁有者不能自行離開（要先刪專案）');
  -- §3.3：離開成員的分頁保留、變唯讀，項目不會消失
  perform ok((select count(*) from items where owner_user_id = '22222222-2222-2222-2222-222222222222') = 1,
    '離開成員的項目保留，其他人仍讀得到');
end $$;

-- 刪除地區：項目變未分類，不會跟著被刪（§4.2）
select id as region_tokyo from regions where name = '東京' \gset
delete from regions where id = :'region_tokyo';
do $$ begin
  -- Jean 的項目在 F-47 那段被刪掉了，剩 Ruby 的那筆
  perform ok((select count(*) from items) = 1, '刪地區不會連帶刪掉項目');
end $$;

-- 擁有者軟刪除專案。這裡一定要用 RPC，直接 update 會被自己的 select 政策擋掉
-- （PostgreSQL 對 UPDATE 會把 SELECT 政策也套在新列上，而新列的 deleted_at 不再是 null）。
select denied(
  format('update trips set deleted_at = now() where id = %L', :'trip_id'),
  '直接 update deleted_at 會被擋（所以要走 delete_trip）');

select delete_trip(:'trip_id');
do $$ begin
  perform ok((select count(*) from trips) = 0, '擁有者用 delete_trip 軟刪除成功');
end $$;

reset role;
\echo ''
\echo '  RLS 權限驗證全部通過'
