-- v2.15.1：公休日從單選改成多選（closed_day text → closed_days text[]）。
-- 有些店一週休兩天（例：週一、週四），單選表達不了。
--
-- closed_day 這一版**不 drop**。正式站部署有幾分鐘的空窗，舊版前端還在使用者的
-- 分頁裡而且還會寫 closed_day —— 這時候 drop 掉，那幾分鐘內所有存檔都會直接失敗。
-- 下一版再拿掉，但拿掉之前要再回填一次，理由見下面第 2 段。
--
-- 這支是這個專案第一支會對 items / itinerary_entries 做 UPDATE 的 migration，
-- 踩到一個前幾支（都只是 add column）碰不到的坑，見第 2 段的 disable trigger。
--
-- RLS 不用動，也不用補 GRANT：只是加欄位，GRANT 是表層級的，既有授權自動涵蓋。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- ── 1. 新欄位 ────────────────────────────────────────────────
-- '{}'       沒填 → 畫面不顯示這一行
-- '{none}'   選了「無」→ 畫面顯示全年無休
-- 其餘       休那幾天
--
-- 用 not null default '{}' 而不是可為 null。單選時代拿 null 當「沒選」，是因為
-- 加欄位之後舊資料本來就是 null、剛好就是那個意思；陣列有空陣列可以表達同一件事，
-- 不用再多一種狀態。少了 not null 的話「沒填」會有 null 和 '{}' 兩種寫法，
-- 前端每個讀取點都要同時處理。
--
-- 內容由前端整理好才寫進來（照週一→週日排、去重、none 不跟星期幾並存）。
-- 排序與去重不在這裡擋：違反了只是畫面上順序怪或重複顯示，擋下來卻是整筆存檔失敗。
-- 下面兩條約束擋的是「會被誤讀成別的意思」的值，那是另一回事。
alter table public.items             add column if not exists closed_days text[] not null default '{}';
alter table public.itinerary_entries add column if not exists closed_days text[] not null default '{}';

-- ── 2. 回填 ──────────────────────────────────────────────────
-- items 和 itinerary_entries 都有 before update 的 touch 觸發器，會蓋
-- updated_at = now()、updated_by = auth.uid()。在 SQL Editor 裡 auth.uid() 是
-- null，所以直接跑 UPDATE 會把每一筆被回填的資料「誰改的」清成 null、
-- 「什麼時候改的」全部跳成現在 —— 不報錯，而且回不去。
-- 這兩張表在 migration 裡做 UPDATE 都要先關掉觸發器。關在交易裡面，
-- 失敗整筆回捲，不會留下關著的觸發器。
alter table public.items             disable trigger items_touch;
alter table public.itinerary_entries disable trigger itinerary_touch;

-- where closed_days = '{}' 不只是省事：沒有這個條件的話，重跑這支會把 migration
-- 之後使用者改成多天的值覆蓋回單天。「可重複執行」不是只要不報錯就算。
--
-- 另外，部署空窗那幾分鐘舊版前端寫進來的 closed_day，這次回填抓不到
-- （它們當下 closed_days 已經是 '{}' 但 closed_day 才剛被寫入）。所以下一版
-- drop closed_day 之前要把這兩行原封不動再跑一次，不然那幾筆會無聲消失。
update public.items
   set closed_days = array[closed_day]
 where closed_day is not null and closed_days = '{}';
update public.itinerary_entries
   set closed_days = array[closed_day]
 where closed_day is not null and closed_days = '{}';

alter table public.items             enable trigger items_touch;
alter table public.itinerary_entries enable trigger itinerary_touch;

-- ── 3. 約束 ──────────────────────────────────────────────────
-- 值域：八個合法值的子集。'{}' 是任何陣列的子集，所以沒填自然通過。
-- 含 null 的陣列（'{NULL}'）也擋得住 —— 陣列的 <@ 不走三值邏輯，null 元素對不到
-- 任何東西，整條回 false 而不是 null，所以不用再多加一條防線。有斷言釘住這件事，
-- 因為這跟「CHECK 判定成 null 就是通過」的直覺相反，哪天被改掉會很難發現。
alter table public.items drop constraint if exists items_closed_days_check;
alter table public.items add constraint items_closed_days_check check (
  closed_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'none']::text[]);
alter table public.itinerary_entries drop constraint if exists itinerary_entries_closed_days_check;
alter table public.itinerary_entries add constraint itinerary_entries_closed_days_check check (
  closed_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'none']::text[]);

-- 「無」是互斥的：'{none,mon}' 的意思是「全年無休，但週一公休」，自相矛盾。
-- 這個要擋，因為它不是顯示難看而是讀不出使用者的意思 —— 畫面只能二選一，
-- 選錯就是告訴使用者那天開門（或沒開門），而店實際上相反。
alter table public.items drop constraint if exists items_closed_days_none_alone;
alter table public.items add constraint items_closed_days_none_alone
  check (not ('none' = any(closed_days)) or cardinality(closed_days) = 1);
alter table public.itinerary_entries drop constraint if exists itinerary_entries_closed_days_none_alone;
alter table public.itinerary_entries add constraint itinerary_entries_closed_days_none_alone
  check (not ('none' = any(closed_days)) or cardinality(closed_days) = 1);

-- ── 4. F-47 斷開引用時的快照 ────────────────────────────────
-- 行程上「空的代表讀清單的」那些欄位，清單項目被刪時要留下快照，不然標題留著、
-- 那一欄默默消失。closed_days 跟 hours / station 同一條規則，新欄位要一起補
-- （handoff §4）。這支是逐欄列舉的，漏掉不會報錯。
--
-- closed_day 那一行先留著不動：舊版前端在部署空窗那幾分鐘還會讀它。
-- 下一版 drop 欄位時連這一行一起拿掉。
-- 函式內文跟 schema.sql 那一份逐字一樣（註解也是），這樣兩邊的 prosrc md5
-- 可以直接比對，差一個字就看得出來。
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
         hours       = case when hours <> '[]'::jsonb then hours else old.hours end,
         -- closed_day 是 v2.13.0 的單選版，v2.15.1 已由 closed_days 取代。
         -- 這一行先留著，舊版前端在部署空窗那幾分鐘還會讀它。
         -- 下一版 drop 欄位時連這一行一起拿掉。
         closed_day  = coalesce(closed_day, old.closed_day),
         closed_days = case when cardinality(closed_days) > 0
                            then closed_days else old.closed_days end,
         -- v2.14.0：最近車站同理
         station     = case when btrim(station) <> '' then station else old.station end,
         -- 沒有這個記號的話，「使用者自己打的」和「引用被刪掉的」分不出來，
         -- 每一筆自由輸入的項目都會被誤標成「原項目已刪除」
         detached_at = now(),
         updated_at  = now()
   where item_id = old.id;
  return old;
end $$;

commit;

-- 驗證：兩張表都有新欄位，not null、預設空陣列
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and column_name = 'closed_days'
order by table_name;

-- 驗證：四條約束都在
select conrelid::regclass as 資料表, conname as 約束, pg_get_constraintdef(oid) as 定義
from pg_constraint
where conname like '%closed_days%'
order by 1, 2;

-- 驗證：觸發器回到啟用狀態（'O' = 原始啟用，'D' = 停用）
select tgrelid::regclass as 資料表, tgname as 觸發器, tgenabled as 狀態
from pg_trigger
where tgname in ('items_touch', 'itinerary_touch')
order by 1;

-- 驗證：回填完整，而且沒有把「誰改的」清掉
select '回填對不上的筆數' as 檢查,
       (select count(*) from public.items
         where closed_day is not null and closed_days = '{}')
     + (select count(*) from public.itinerary_entries
         where closed_day is not null and closed_days = '{}') as 筆數
union all
select '有公休日但沒有「誰改的」的項目',
       (select count(*) from public.items
         where closed_days <> '{}' and updated_by is null and updated_at > created_at);

-- 既有資料的分布
select cardinality(closed_days) as 公休天數, count(*) from public.items
group by 1 order by 1;
