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
  id text primary key, name text, public boolean, file_size_limit bigint,
  -- 正式 Supabase 有這一欄（null = 不限類型）。schema.sql 從 v2.9.0 起會明確
  -- 設定它，好讓 media 收得下 PDF，mock 少了這欄就會在載入 schema.sql 時炸掉。
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

-- 角色是叢集層級的，重跑時不會被 drop schema 清掉。
-- service_role 本身不參與測試，但 schema.sql 的授權段會提到它，沒有就會報錯。
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

-- ── 受測對象 ────────────────────────────────────────────────
\ir schema.sql

-- 這裡刻意不再 grant public schema 的表與函式 —— schema.sql 第 7 節自己會授權。
-- 以前這裡是 `grant all on all tables in schema public`，那會蓋掉真實的授權狀態：
-- 就算 schema.sql 一條 grant 都沒有，測試照樣全過，而重建出來的環境每張表都是
-- 42501。現在測試跑的是正式環境真正會有的那組權限。
--
-- 正式 Supabase 的 authenticated 本來就叫得動 auth.uid()，這個 mock 要補上才一致。
-- 少了它，security definer 的函式看不出差別（它們用的是擁有者權限），但 security
-- invoker 的 RPC 一進去就 permission denied for schema auth —— 那是harness 的差異，
-- 不是程式的問題，補齊才不會逼著把 RPC 改成 definer 來迴避。
grant usage on schema auth to authenticated;
grant execute on all functions in schema auth to authenticated;

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
  -- tags_select 放寬到「同專案成員」之後，非成員這條邊界要有人守著
  perform ok((select count(*) from tags) = 0, '非成員看不到標籤');
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

-- 第三種子清單「參考」：權限跟 place / shopping 完全一樣，只是多一個合法的 type。
-- 驗完就刪掉，後面好幾條斷言是數 items 的總筆數，留著會讓它們全部要改數字。
insert into items (trip_id, owner_user_id, type, title, created_by)
  values (:'trip_id', :'ruby', 'reference', '京都兩天一夜 vlog', :'ruby');
do $$ begin
  perform ok((select count(*) from items where type = 'reference') = 1,
    '可以新增參考類型的項目');
end $$;
-- 放寬 CHECK 之後，亂填的 type 仍然要被擋住
select denied(
  format('insert into items (trip_id, owner_user_id, type, title, created_by) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'ruby', 'xxx', '亂填類型', :'ruby'),
  '不是三種之一的 type 仍然擋著');

-- 置頂（v2.13.0）。借上面那筆參考當素材，跟著一起被下面的 delete 清掉。
select id as ruby_ref from items where type = 'reference' \gset
do $$ begin
  perform ok((select pinned_at from items where type = 'reference') is null,
    '新增的項目預設沒有置頂');
end $$;
update items set pinned_at = now() where id = :'ruby_ref';
do $$ begin
  perform ok((select pinned_at from items where type = 'reference') is not null,
    '本人可以置頂自己的項目');
end $$;
update items set pinned_at = null where id = :'ruby_ref';
do $$ begin
  perform ok((select pinned_at from items where type = 'reference') is null,
    '置頂可以取消');
end $$;
-- 重點：置頂沒有自己的 policy，靠的是 items_update 的 owner 檢查。
-- 哪天那條 using 被放寬，這裡會先叫。
select denied(
  format('update items set pinned_at = now() where id = %L', :'jean_item'),
  'Ruby 不能置頂 Jean 分頁的項目');

-- 營業時間與公休日（v2.13.0；公休日 v2.15.1 從單選改成多選）
do $$ begin
  perform ok((select hours from items where type = 'reference') = '[]'::jsonb,
    '營業時間預設是空陣列，不是 null');
  perform ok((select closed_days from items where type = 'reference') = '{}',
    '公休日預設是空陣列（＝沒填，跟選了「無」不一樣）');
end $$;
-- 午休分兩段，而且第二段跨夜（18:00 開到隔天 02:00）。
-- close 早於 open 要存得進去 —— 加約束擋掉的話半夜場就填不了。
update items set hours = '[{"open":"11:00","close":"14:30"},{"open":"18:00","close":"02:00"}]'::jsonb,
                 closed_days = '{mon,thu}'
where id = :'ruby_ref';
do $$ begin
  perform ok((select jsonb_array_length(hours) from items where type = 'reference') = 2,
    '營業時間可以存多段（午休）');
  perform ok((select hours -> 1 ->> 'close' from items where type = 'reference') = '02:00',
    '收店時間早於開店時間存得進去（營業到半夜）');
  perform ok((select closed_days from items where type = 'reference') = '{mon,thu}',
    'v2.15.1：一週可以休好幾天');
end $$;
update items set closed_days = '{none}' where id = :'ruby_ref';
do $$ begin
  perform ok((select closed_days from items where type = 'reference') = '{none}',
    '「無」是一個實際的值，不是空陣列');
end $$;
select denied(
  format('update items set closed_days = %L where id = %L', '{monday}', :'ruby_ref'),
  '不是那八個值的公休日會被擋');
-- 這一條釘的是一個跟直覺相反的性質：CHECK 判定成 null 是**通過**，所以
-- 「`<@` 碰到 null 會回 null」的話 '{NULL}' 就會溜進來（cardinality 是 1、
-- 看起來像有選一天，畫面上卻是空白）。實際上陣列的 <@ 不走三值邏輯，
-- null 元素對不到任何東西，整條回 false。值域約束因此不需要第二條防線 ——
-- 但這件事夠反直覺，哪天 <@ 被換成別的寫法會無聲失守，所以留一條斷言。
select denied(
  format('update items set closed_days = %L where id = %L', '{NULL}', :'ruby_ref'),
  '含 null 的公休日會被擋（陣列的 <@ 回 false 不是 null，CHECK 才攔得住）');
select denied(
  format('update items set closed_days = %L where id = %L', '{none,mon}', :'ruby_ref'),
  '「無」不能跟星期幾並存（全年無休又週一公休，讀不出是哪個意思）');
-- 排序與去重刻意不擋：違反了只是畫面順序怪或重複顯示，擋下來卻是整筆存檔失敗。
do $$ begin
  update items set closed_days = '{thu,mon,mon}' where type = 'reference';
  perform ok((select cardinality(closed_days) from items where type = 'reference') = 3,
    '沒排序、有重複的公休日存得進去（前端整理，資料庫不擋）');
end $$;
update items set closed_days = '{none}' where type = 'reference';

delete from items where type = 'reference';

-- ── 標籤：成員都看得到，只有本人能改（F-22）──────────────────
insert into tags (trip_id, user_id, name) values (:'trip_id', :'ruby', '拉麵');
do $$ begin
  perform ok((select count(*) from tags) = 2,
    'Ruby 看得到同專案成員的標籤（看別人清單時要能照標籤篩選）');
  perform ok((select count(*) from tags where name = '拉麵') = 2,
    '同名標籤各自獨立，不會互相覆蓋');
end $$;

select denied(
  format('insert into tags (trip_id, user_id, name) values (%L, %L, %L)', :'trip_id', :'jean', '冒名標籤'),
  '不能建立掛在別人名下的標籤');

select id as jean_tag from tags where user_id = :'jean' \gset
select denied(
  format('update tags set name = %L where id = %L', '被改名', :'jean_tag'),
  '看得到別人的標籤，但不能改名');
select denied(
  format('delete from tags where id = %L', :'jean_tag'),
  '看得到別人的標籤，但不能刪除');

-- ── 送禮清單只有本人看得到（v2.6.0）──────────────────────────
-- 同行的人可能就是收禮對象，所以 gift 這一種不跟著「成員互相看得到」。
-- 驗完自己清掉，後面有斷言在數 items 的筆數。
insert into items (trip_id, owner_user_id, type, title, created_by)
  values (:'trip_id', :'ruby', 'gift', '送媽媽的珍珠項鍊', :'ruby');
select id as ruby_gift from items where type = 'gift' \gset
-- 順便掛一個標籤，等下驗 item_tags 不會從側面把 gift 漏出去
insert into item_tags (item_id, tag_id)
  select :'ruby_gift', id from tags where user_id = :'ruby' and name = '拉麵';
do $$ begin
  perform ok((select count(*) from items where type = 'gift') = 1, 'Ruby 看得到自己的送禮項目');
end $$;
update items set title = '改成絲巾' where id = :'ruby_gift';
do $$ begin
  perform ok((select title from items where id = (select id from items where type = 'gift')) = '改成絲巾',
    'Ruby 改得動自己的送禮項目');
end $$;

set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform ok((select count(*) from items where type = 'gift') = 0,
    '同行成員看不到別人的送禮項目');
  -- 這條是重點：item_tags 的 select 是 join items 判斷的，只改 items_select
  -- 不改這裡的話，別人會從標籤關聯看出「A 有一個標著某某的東西」
  perform ok((select count(*) from item_tags where item_id = (
               select id from items where owner_user_id = '22222222-2222-2222-2222-222222222222'
                 and type = 'gift')) = 0,
    '別人的送禮項目不會從 item_tags 漏出去');
  -- 其他三種照舊看得到，不要把整個清單一起鎖住
  perform ok((select count(*) from items where type in ('place', 'shopping', 'reference')
              and owner_user_id = '22222222-2222-2222-2222-222222222222') > 0,
    '同行成員仍看得到對方的地點／購物／參考');
end $$;
select denied(
  format('update items set title = %L where id = %L', '亂改別人的禮物', :'ruby_gift'),
  '不能改別人的送禮項目');

set app.uid = '22222222-2222-2222-2222-222222222222';
delete from item_tags where item_id = :'ruby_gift';
delete from items where id = :'ruby_gift';

-- 標籤分兩池：參考的跟地點／購物的分開，同名要能各自獨立存在。
-- 驗完一樣自己刪掉，後面有斷言在數 tags 的筆數。
do $$ begin
  perform ok((select count(*) from tags where scope <> 'default') = 0,
    '既有標籤全部留在預設池');
end $$;
insert into tags (trip_id, user_id, scope, name) values (:'trip_id', :'ruby', 'default', '拍食物');
insert into tags (trip_id, user_id, scope, name) values (:'trip_id', :'ruby', 'reference', '拍食物');
do $$ begin
  perform ok((select count(*) from tags where name = '拍食物') = 2,
    '同名標籤在兩個池裡各自獨立');
end $$;
-- 同一池裡同名仍然要被唯一鍵擋住
select denied(
  format('insert into tags (trip_id, user_id, scope, name) values (%L, %L, %L, %L)',
         :'trip_id', :'ruby', 'reference', '拍食物'),
  '同一池裡不能有兩個同名標籤');
delete from tags where name = '拍食物';

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

-- v2.7.0：每日備註也能放連結。重點是「只有連結、備註是空字串」要存得進去 ——
-- F-43 的「沒備註就不留資料列」現在是前端的刪除條件，不是資料庫的約束。
update trip_days set note = '',
  links = '[{"id":"l1","url":"https://ex.test/a","title":"雨天備案"}]'::jsonb
where date = '2026-11-13';
do $$ begin
  perform ok((select jsonb_array_length(links) from trip_days where date = '2026-11-13') = 1,
    '每日備註可以放連結');
  perform ok((select note from trip_days where date = '2026-11-13') = '',
    '只有連結、備註留空也存得進去');
end $$;
update trip_days set note = '住新宿，記得帶傘', links = '[]'::jsonb where date = '2026-11-13';

-- v2.7.0：每日備註可以引用願望清單的「參考」（那天要拍哪幾支 reels）。
-- 順便釘住一件事：這個欄位只有 id，引用不等於給了讀取權 —— 故意塞一個別人
-- 讀不到的 gift id 進去，確認對方還是讀不到那筆 item。資料庫因此不需要驗證
-- ref_ids 的內容（見 migrate-day-refs.sql 的說明）。
insert into items (trip_id, owner_user_id, type, title, created_by)
  values (:'trip_id', :'ruby', 'gift', 'reels 隱私探針', :'ruby');
select id as probe_gift from items where title = 'reels 隱私探針' \gset
update trip_days set ref_ids = array[:'probe_gift'::uuid] where date = '2026-11-13';
do $$ begin
  perform ok((select cardinality(ref_ids) from trip_days where date = '2026-11-13') = 1,
    '每日備註可以引用參考');
end $$;

set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform ok((select count(*) from trip_days where date = '2026-11-13') = 1,
    '同行成員看得到那一天的備註');
  perform ok((select count(*) from items where id = (
               select unnest(ref_ids) from trip_days where date = '2026-11-13')) = 0,
    '被引用的 id 仍然要過 items 的 RLS，引用不等於給了讀取權');
end $$;

set app.uid = '22222222-2222-2222-2222-222222222222';
update trip_days set ref_ids = '{}' where date = '2026-11-13';
delete from items where id = :'probe_gift';

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

-- v2.4.0 行程圖片：自己打的地點可以放，引用清單的那種不行（照片跟著清單項目走，Q10）。
-- 驗完自己刪掉，後面有斷言在數 itinerary_entries 的筆數。
insert into itinerary_entries (trip_id, date, section, slot, title, images, created_by)
values (:'trip_id', '2026-11-13', 'schedule', 'evening', '自己打的夜景點',
        '[{"path":"t/a.jpg","thumbPath":"t/a-s.jpg","w":1600,"h":1200}]'::jsonb, :'ruby');
do $$ begin
  perform ok((select jsonb_array_length(images) from itinerary_entries
              where title = '自己打的夜景點') = 1,
    '自己打的地點可以放圖片');
end $$;
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, item_id, images, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'evening', :'jean_item',
         '[{"path":"t/b.jpg"}]', :'ruby'),
  '引用清單的行程項目不能自己存圖');

-- v2.5.0 行程地區：同樣只有自己打的地點可以選，引用清單的跟著清單項目走
select id as tokyo_id from regions where name = '東京' \gset
update itinerary_entries set region_id = :'tokyo_id'
where title = '自己打的夜景點';
do $$ begin
  perform ok((select region_id from itinerary_entries where title = '自己打的夜景點') is not null,
    '自己打的地點可以選地區');
end $$;
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, item_id, region_id, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'evening', :'jean_item',
         :'tokyo_id', :'ruby'),
  '引用清單的行程項目不能自己選地區');

-- v2.13.0 行程營業時間：同圖片與地區，引用清單的那種讀 items 的值，自己這兩欄留空
update itinerary_entries set hours = '[{"open":"10:00","close":"18:00"}]'::jsonb,
                             closed_days = '{wed}'
where title = '自己打的夜景點';
do $$ begin
  perform ok((select jsonb_array_length(hours) from itinerary_entries
              where title = '自己打的夜景點') = 1,
    '自己打的地點可以填營業時間');
  perform ok((select closed_days from itinerary_entries where title = '自己打的夜景點') = '{wed}',
    '自己打的地點可以選公休日');
end $$;
-- 兩條約束在 itinerary_entries 上也要有。只加在 items 上的話，
-- 行程這邊照樣存得進矛盾的值，而畫面讀的就是行程這一列（覆寫優先）。
select denied(
  format('update itinerary_entries set closed_days = %L where title = %L',
         '{none,wed}', '自己打的夜景點'),
  '行程的公休日一樣擋「無」跟星期幾並存');
select denied(
  format('update itinerary_entries set closed_days = %L where title = %L',
         '{NULL}', '自己打的夜景點'),
  '行程的公休日一樣擋含 null 的陣列');
-- v2.13.2：引用別人清單的地點，可以自己填營業時間蓋過清單的值。
-- 別人的清單項目改不動（items_update 限本人），所以覆寫只能存在行程這一列。
-- 這裡引用的是 Jean 的項目，Ruby 改不了 Jean 的清單。
-- v2.14.0 的 station 走同一套規則，所以一起驗。
insert into itinerary_entries (trip_id, date, section, slot, item_id, hours, closed_days, station, created_by)
values (:'trip_id', '2026-11-13', 'schedule', 'evening', :'jean_item',
        '[{"open":"09:00","close":"17:00"}]'::jsonb, '{thu,sun}', 'JR 新宿站 東口', :'ruby');
do $$ begin
  perform ok((select jsonb_array_length(hours) from itinerary_entries
              where item_id is not null and hours <> '[]'::jsonb) = 1,
    '引用別人清單的行程可以自己填營業時間（v2.13.2 覆寫）');
  perform ok((select closed_days from itinerary_entries
              where item_id is not null and closed_days <> '{}') = '{thu,sun}',
    '引用別人清單的行程可以自己選公休日（而且可以多天）');
  perform ok((select station from itinerary_entries where closed_days = '{thu,sun}') = 'JR 新宿站 東口',
    '引用別人清單的行程可以自己填最近車站（v2.14.0 覆寫）');
  -- 釘住「覆寫不會回寫到清單」：Ruby 改不動 Jean 的 items，
  -- 所以 Jean 那筆的營業時間與最近車站都必須原封不動
  perform ok((select hours from items where id = (
               select item_id from itinerary_entries where closed_days = '{thu,sun}')) = '[]'::jsonb,
    '覆寫只存在行程那一列，不會回寫到別人的清單');
  perform ok((select station from items where id = (
               select item_id from itinerary_entries where closed_days = '{thu,sun}')) = '',
    '最近車站的覆寫也不會回寫到別人的清單');
  perform ok((select closed_days from items where id = (
               select item_id from itinerary_entries where closed_days = '{thu,sun}')) = '{}',
    '公休日的覆寫也不會回寫到別人的清單');
end $$;
select denied(
  format('update items set station = %L where id = %L', '偷改別人的車站', :'jean_item'),
  'Ruby 不能直接改 Jean 清單項目的最近車站');
-- images 與 region_id 沒有跟著放行，它們仍然只能由清單那邊決定
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, item_id, images, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'evening', :'jean_item',
         '[{"path":"t/c.jpg"}]', :'ruby'),
  '放行營業時間不等於放行照片，引用的照片仍然跟著清單走');
delete from itinerary_entries where closed_days = '{thu,sun}';

-- v2.9.0：航班與住宿可以附 PDF，其他 kind 不行。
-- 這段同時驗了「加欄位不需要補 grant」—— 是以 authenticated 的身分寫入新欄位，
-- 寫得進去就代表既有的表層授權涵蓋了它（這個 schema 沒有 column-level grant）。
insert into itinerary_entries (trip_id, date, section, slot, kind, title, files, created_by)
values (:'trip_id', '2026-11-13', 'schedule', 'morning', 'flight', '桃園 → 成田',
        '[{"path":"t/e.pdf","name":"eticket.pdf","size":120000}]'::jsonb, :'ruby');
do $$ begin
  perform ok((select jsonb_array_length(files) from itinerary_entries where title = '桃園 → 成田') = 1,
    '航班可以附 PDF');
end $$;
select denied(
  format('insert into itinerary_entries (trip_id, date, section, slot, kind, title, files, created_by) values (%L, %L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', '2026-11-13', 'schedule', 'morning', 'place', '一般地點',
         '[{"path":"t/f.pdf","name":"x.pdf","size":100}]', :'ruby'),
  '只有航班與住宿能附 PDF');
delete from itinerary_entries where title = '桃園 → 成田';

delete from itinerary_entries where title = '自己打的夜景點';

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
-- v2.13.2：營業時間也要留快照。這一列刻意只覆寫公休日、營業時間留空，
-- 好讓兩個分支在同一筆資料上都被走到：
--   hours       空的 → 要填入被刪項目的值（不然標題留著、營業時間默默消失）
--   closed_days 有值 → 是這一列自己的覆寫，不能被被刪項目的值蓋掉
-- v2.14.0 的 station 一起驗，它也是「空的＝讀清單的」。
-- v2.15.1：清單那邊刻意存兩天，好確認快照留下的是整個陣列而不是只有第一天。
update items set hours = '[{"open":"11:00","close":"23:00"}]'::jsonb,
                 closed_days = '{tue,fri}',
                 station = '東京 Metro 新宿三丁目站'
where id = :'jean_item';
update itinerary_entries set closed_days = '{sat}' where id = :'ref_entry';
-- 一列只能走到每個欄位的一個分支，所以再引用一筆專門走覆寫分支：
-- ref_entry 的 title 與 station 都是空的（驗快照），這一筆兩個都有值（驗不被蓋掉）。
-- 這一筆的 title 一定要跟被刪項目的不一樣，不然斷開後兩列的 title 會撞在一起，
-- 上面那些 where title = '一蘭 新宿' 的斷言會變成一次撈到兩列。
insert into itinerary_entries (trip_id, date, section, slot, item_id, title, station, created_by)
values (:'trip_id', '2026-11-14', 'schedule', 'morning', :'jean_item',
        '一蘭 新宿（早場）', '都營 新宿站', :'jean');
delete from items where id = :'jean_item';
do $$ begin
  perform ok((select count(*) from itinerary_entries) = 4, 'F-47：刪地點不連鎖刪行程項目');
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
  -- v2.13.2：沒有這兩條的話，斷開後標題留著、營業時間默默不見，而且不會報錯
  perform ok((select hours from itinerary_entries where title = '一蘭 新宿')
             = '[{"open":"11:00","close":"23:00"}]'::jsonb,
    'F-47：沿用清單的營業時間在斷開時有留下快照');
  perform ok((select closed_days from itinerary_entries where title = '一蘭 新宿') = '{sat}',
    'F-47：這一列自己覆寫的公休日不會被被刪項目的值蓋掉');
  -- v2.15.1：另一筆的 closed_days 是空的，走快照分支。整個陣列都要留下 ——
  -- 只留第一天的話，一週休兩天的店斷開後會變成只休一天，而且不報錯。
  perform ok((select closed_days from itinerary_entries where title = '一蘭 新宿（早場）')
             = '{tue,fri}',
    'F-47：沿用清單的公休日在斷開時整個陣列都有留下快照');
  -- v2.14.0：最近車站兩個分支各驗一筆
  perform ok((select station from itinerary_entries where title = '一蘭 新宿')
             = '東京 Metro 新宿三丁目站',
    'F-47：沿用清單的最近車站在斷開時有留下快照');
  perform ok((select station from itinerary_entries where title = '一蘭 新宿（早場）') = '都營 新宿站',
    'F-47：這一列自己覆寫的最近車站不會被被刪項目的值蓋掉');
  perform ok((select title from itinerary_entries where title = '一蘭 新宿（早場）') = '一蘭 新宿（早場）',
    'F-47：這一列自己取的標題不會被被刪項目的標題蓋掉');
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

-- ── 記帳（v2.2.0）：共同帳全員共用、個人帳只有本人 ──────────────
-- 這一段要跑在 Ruby 還是 active 成員的時候，所以放在「離開」之前。
-- 驗完自己清乾淨，後面有斷言在數別張表的筆數，不要留殘渣。
select save_group_expense(
  jsonb_build_object(
    'id', '77777777-0000-0000-0000-000000000001', 'trip_id', :'trip_id', 'kind', 'group',
    'title', '晚餐 居酒屋', 'amount', 3000, 'currency', 'JPY', 'date', '2026-11-13',
    'note', '', 'category', 'food', 'payer_id', :'ruby'),
  jsonb_build_array(
    jsonb_build_object('user_id', :'ruby', 'amount', 1500, 'settled', false),
    jsonb_build_object('user_id', :'jean', 'amount', 1500, 'settled', false)));
do $$ begin
  perform ok((select count(*) from expenses where kind = 'group') = 1, '成員可以新增共同帳');
  perform ok((select count(*) from expense_shares) = 2, '分攤跟著帳目一起寫進去');
end $$;

-- v2.12.0 分類：共同帳是走 RPC 存的，所以要驗 RPC 真的有把 category 寫進去。
-- 這條沒守住的話失敗是沉默的 —— 類別永遠停在 'other'，畫面正常、統計全錯。
do $$ begin
  perform ok((select category from expenses where kind = 'group') = 'food',
    'save_group_expense 有寫入 category');
end $$;
select denied(
  format('insert into expenses (trip_id, kind, title, amount, currency, date, category, owner_user_id, created_by) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
         :'trip_id', 'personal', '亂填類別', 100, 'JPY', '2026-11-13', 'xxx', :'ruby', :'ruby'),
  '不是那六個值的 category 會被擋');

-- 加總對不起來要擋：差一塊錢就是有人的份沒算到，存進去要等分帳才會發現
select denied(
  format('select save_group_expense(%L::jsonb, %L::jsonb)',
    jsonb_build_object('id', '77777777-0000-0000-0000-000000000002', 'trip_id', :'trip_id',
      'kind', 'group', 'title', '湊不攏', 'amount', 3000, 'currency', 'JPY',
      'date', '2026-11-13', 'note', '', 'payer_id', :'ruby'),
    jsonb_build_array(jsonb_build_object('user_id', :'ruby', 'amount', 1000, 'settled', false))),
  '分攤加總不等於總額時拒絕');

-- settled 任何成員都能勾，不是只有當事人：現場誰收到錢誰就順手標
update expense_shares set settled = true where user_id = :'jean';
do $$ begin
  perform ok((select settled from expense_shares
              where user_id = '11111111-1111-1111-1111-111111111111') = true,
    '成員可以勾別人的分攤為已付清');
end $$;

-- 編輯時把 Jean 從名單上拿掉，他的分攤要跟著消失
select save_group_expense(
  jsonb_build_object(
    'id', '77777777-0000-0000-0000-000000000001', 'trip_id', :'trip_id', 'kind', 'group',
    'title', '晚餐 居酒屋', 'amount', 3000, 'currency', 'JPY', 'date', '2026-11-13',
    'note', '改成自己請', 'category', 'transport', 'payer_id', :'ruby'),
  jsonb_build_array(jsonb_build_object('user_id', :'ruby', 'amount', 3000, 'settled', false)));
do $$ begin
  perform ok((select count(*) from expense_shares
              where expense_id = '77777777-0000-0000-0000-000000000001') = 1,
    '編輯時從名單拿掉的人，分攤會被刪掉');
  -- upsert 的 update 分支也要改 category，不是只有 insert 寫得對就算過
  perform ok((select category from expenses
              where id = '77777777-0000-0000-0000-000000000001') = 'transport',
    '編輯共同帳時 category 會跟著改');
end $$;

-- 個人帳：Ruby 建一筆，而且是從上面那筆共同帳複製進來的
insert into expenses (id, trip_id, kind, title, amount, currency, date, owner_user_id,
                      source_expense_id, created_by)
values ('77777777-0000-0000-0000-000000000003', :'trip_id', 'personal', '我那份晚餐',
        3000, 'JPY', '2026-11-13', :'ruby', '77777777-0000-0000-0000-000000000001', :'ruby');

-- 換 Jean：共同帳看得到，Ruby 的個人帳完全看不到也改不了
set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform ok((select count(*) from expenses where kind = 'group') = 1, '成員看得到共同帳');
  perform ok((select count(*) from expenses where kind = 'personal') = 0,
    '看不到別人的個人帳');
end $$;
select denied(
  format('update expenses set title = %L where id = %L',
         '亂改', '77777777-0000-0000-0000-000000000003'),
  '不能改別人的個人帳');
select denied(
  format('delete from expenses where id = %L', '77777777-0000-0000-0000-000000000003'),
  '不能刪別人的個人帳');

-- 非成員兩種都看不到
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform ok((select count(*) from expenses) = 0, '非成員看不到任何帳目');
  perform ok((select count(*) from expense_shares) = 0, '非成員看不到分攤');
end $$;
select denied(
  format('select save_group_expense(%L::jsonb, %L::jsonb)',
    jsonb_build_object('id', '77777777-0000-0000-0000-000000000004', 'trip_id', :'trip_id',
      'kind', 'group', 'title', '非成員亂記', 'amount', 100, 'currency', 'JPY',
      'date', '2026-11-13', 'note', '', 'payer_id', :'kai'),
    jsonb_build_array(jsonb_build_object('user_id', :'kai', 'amount', 100, 'settled', false))),
  '非成員不能呼叫 save_group_expense');

-- 刪掉共同帳：分攤連帶消失，但從它複製出去的個人帳要留著，只是斷開來源
set app.uid = '22222222-2222-2222-2222-222222222222';
delete from expenses where id = '77777777-0000-0000-0000-000000000001';
do $$ begin
  perform ok((select count(*) from expense_shares) = 0, '刪共同帳時分攤連帶刪掉');
  perform ok((select count(*) from expenses where id = '77777777-0000-0000-0000-000000000003') = 1,
    '刪共同帳之後，複製出去的個人帳還在');
  perform ok((select source_expense_id from expenses
              where id = '77777777-0000-0000-0000-000000000003') is null,
    '個人帳的來源被斷開，不是跟著被刪');
end $$;
delete from expenses where id = '77777777-0000-0000-0000-000000000003';

-- ── 行李清單（v2.15.0）：整張表只有本人 ─────────────────────
-- 目前身分是 Ruby。
select init_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000001', 'parent_id', null,
                     'kind', 'group', 'title', '托運行李', 'qty', null, 'sort_order', 0),
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000002',
                     'parent_id', '99999999-0000-0000-0000-000000000001',
                     'kind', 'item', 'title', '牙刷', 'qty', 2, 'sort_order', 0)
));
do $$ begin
  perform ok((select count(*) from packing_nodes) = 2, 'init_packing 放進預設清單');
  perform ok((select qty from packing_nodes where title = '牙刷') = 2, '物品可以有數量');
  perform ok((select count(*) from packing_lists) = 1, 'init_packing 留下初始化記號');
end $$;

-- 第二次呼叫不能再插一份。這同時是「刪光後不會被塞回預設」的保證 ——
-- 判斷的是記號在不在，不是現在有沒有節點。
select init_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000009', 'parent_id', null,
                     'kind', 'item', 'title', '不該出現的第二份', 'qty', null, 'sort_order', 0)
));
do $$ begin
  perform ok((select count(*) from packing_nodes) = 2, 'init_packing 呼叫兩次只有一份');
end $$;
-- 刪光再 init，仍然不會被塞回預設
delete from packing_nodes where parent_id is null;
select init_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-00000000000a', 'parent_id', null,
                     'kind', 'item', 'title', '也不該出現', 'qty', null, 'sort_order', 0)
));
do $$ begin
  perform ok((select count(*) from packing_nodes) = 0,
    '使用者刪光清單後，再進頁面不會被塞回預設');
end $$;

-- 重新鋪一份來測其餘的規則
select replace_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000001', 'parent_id', null,
                     'kind', 'group', 'title', '托運行李', 'qty', null, 'sort_order', 0),
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000002',
                     'parent_id', '99999999-0000-0000-0000-000000000001',
                     'kind', 'item', 'title', '牙刷', 'qty', 2, 'sort_order', 0)
));
update packing_nodes set packed = true where title = '牙刷';
do $$ begin
  perform ok((select count(*) from packing_nodes) = 2, 'replace_packing 整份換掉');
  perform ok((select packed from packing_nodes where title = '牙刷'), '可以勾已打包');
end $$;

-- 刪群組要連子孫一起走
select replace_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000001', 'parent_id', null,
                     'kind', 'group', 'title', '托運行李', 'qty', null, 'sort_order', 0),
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000002',
                     'parent_id', '99999999-0000-0000-0000-000000000001',
                     'kind', 'item', 'title', '牙刷', 'qty', 2, 'sort_order', 0)
));
do $$ begin
  -- 整份取代後打勾要清掉，不然「從其他旅程複製」會把上一趟的打勾帶過來
  perform ok((select packed from packing_nodes where title = '牙刷') = false,
    'replace_packing 之後 packed 全部回到 false');
end $$;
delete from packing_nodes where id = '99999999-0000-0000-0000-000000000001';
do $$ begin
  perform ok((select count(*) from packing_nodes) = 0, '刪群組時子孫連帶被刪');
end $$;

-- 父節點的三個一致性條件
select replace_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000001', 'parent_id', null,
                     'kind', 'group', 'title', '托運行李', 'qty', null, 'sort_order', 0),
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000002',
                     'parent_id', '99999999-0000-0000-0000-000000000001',
                     'kind', 'item', 'title', '牙刷', 'qty', 2, 'sort_order', 0)
));
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, parent_id, kind, title) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'ruby', '99999999-0000-0000-0000-000000000002', 'item', '掛在牙刷底下'),
  '物品底下不能再掛東西');
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, parent_id, kind, title) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'ruby', '99999999-0000-0000-0000-00000000ffff', 'item', '掛到不存在的父節點'),
  'parent 指到不存在的節點會被擋');
-- 群組不准有數量：那個值永遠不顯示，卻會被複製來複製去
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, kind, title, qty) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'ruby', 'group', '有數量的群組', 3),
  '群組不能有數量');
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, kind, title) values (%L, %L, %L, %L)',
         :'trip_id', :'ruby', 'item', '   '),
  '只有空白的標題會被擋');

-- 別的成員（Jean）完全碰不到 Ruby 的行李
set app.uid = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform ok((select count(*) from packing_nodes) = 0, '同行成員看不到我的行李清單');
  perform ok((select count(*) from packing_lists) = 0, '同行成員看不到我的初始化記號');
end $$;
select denied(
  format('update packing_nodes set title = %L where id = %L',
         '被別人改掉', '99999999-0000-0000-0000-000000000002'),
  '同行成員改不動我的行李');
select denied(
  format('delete from packing_nodes where id = %L', '99999999-0000-0000-0000-000000000002'),
  '同行成員刪不掉我的行李');
-- 這條是重點：FK 不看 owner，所以沒有 check_packing_parent 的話，
-- 知道節點 id 的人可以把自己的節點掛到別人的群組底下 —— 讀不到對方的資料，
-- 但對方刪群組時 cascade 會連帶刪掉你的東西。
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, parent_id, kind, title) values (%L, %L, %L, %L, %L)',
         :'trip_id', :'jean', '99999999-0000-0000-0000-000000000001', 'item', '掛到別人的群組'),
  '不能把自己的節點掛到別人的群組底下');
-- Jean 自己的行李是另一份，互不干擾
select init_packing(:'trip_id', jsonb_build_array(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000011', 'parent_id', null,
                     'kind', 'item', 'title', 'Jean 的護照', 'qty', null, 'sort_order', 0)
));
do $$ begin
  perform ok((select count(*) from packing_nodes) = 1, '每個人的行李是各自獨立的一份');
end $$;

-- 非成員完全碰不到
set app.uid = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform ok((select count(*) from packing_nodes) = 0, '非成員看不到任何行李');
end $$;
select denied(
  format('insert into packing_nodes (trip_id, owner_user_id, kind, title) values (%L, %L, %L, %L)',
         :'trip_id', :'kai', 'item', '非成員亂塞'),
  '非成員不能在別人的專案裡建行李');
select denied(
  format('select init_packing(%L, %L::jsonb)', :'trip_id', '[]'),
  '非成員呼叫 init_packing 也沒用');

set app.uid = '11111111-1111-1111-1111-111111111111';
delete from packing_nodes;
delete from packing_lists;
set app.uid = '22222222-2222-2222-2222-222222222222';
delete from packing_nodes;
delete from packing_lists;

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
