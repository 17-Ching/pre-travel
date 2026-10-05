-- 標籤分兩池：參考的標籤（轉場影片、拍食物、行程參考）跟地點／購物的（拉麵、必去）
-- 分開，否則兩邊的選單都會塞滿用不到的選項。同名可以各自獨立 ——「拍食物」能同時是
-- 地點池的一個標籤、也是參考池的另一個標籤，所以唯一鍵要含 scope。
--
-- 地點與購物共用 'default'，既有資料靠欄位預設值就位，不用回填。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 在 Supabase 後台 SQL Editor 貼上執行即可（它預設整段包在一個交易裡）。

begin;

-- 1. 欄位。not null + default，既有每一列自動是 'default'
alter table public.tags add column if not exists scope text not null default 'default';
alter table public.tags drop constraint if exists tags_scope_check;
alter table public.tags add constraint tags_scope_check check (scope in ('default', 'reference'));

-- 2. 把「只被參考項目用到」的標籤搬到參考池。
-- 參考功能今天才上線，實務上大概 0 筆，但有的話不搬就會從參考的標籤選單裡消失
-- （卡片上還是看得到，因為那是用 id 查的，只是之後選不到也篩不到）。
-- 同時被參考和非參考項目用到的標籤沒辦法拆，留在 'default' 由使用者自己處理。
-- 沒有被任何項目用到的標籤也留在 'default'：沒有依據判斷它本來想放哪一池。
update public.tags g set scope = 'reference'
where exists (
        select 1 from public.item_tags t join public.items i on i.id = t.item_id
        where t.tag_id = g.id and i.type = 'reference')
  and not exists (
        select 1 from public.item_tags t join public.items i on i.id = t.item_id
        where t.tag_id = g.id and i.type <> 'reference');

-- 3. 唯一鍵換成含 scope 的版本。舊的那條是 inline unique，自動命名長這樣。
alter table public.tags drop constraint if exists tags_trip_id_user_id_name_key;
alter table public.tags drop constraint if exists tags_trip_id_user_id_scope_name_key;
alter table public.tags add constraint tags_trip_id_user_id_scope_name_key
  unique (trip_id, user_id, scope, name);

commit;

-- 驗證：唯一鍵要是四欄版本，而且列出各池的標籤數
select pg_get_constraintdef(oid) as unique_key
from pg_constraint
where conrelid = 'public.tags'::regclass and conname = 'tags_trip_id_user_id_scope_name_key';

select scope, count(*) from public.tags group by scope order by scope;
