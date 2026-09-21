-- F-22 標籤權限放寬：同專案成員看得到彼此的標籤，但只有本人能增刪改。
--
-- 為什麼要改：看別人的願望清單時沒辦法照標籤篩選，討論行程會卡住。
-- 放寬之前那些 tag id 在前端查不到名字，所以他人分頁根本不會出現篩選鈕。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql —— 那支開頭會把所有 policy
-- 先 drop 再重建，對著有真實資料的庫沒必要冒這個險。schema.sql 已經同步成
-- 一樣的結果，之後重建環境會得到同一個形狀。
--
-- 在 Supabase 後台 SQL Editor 貼上執行即可（它預設整段包在一個交易裡）。

begin;

drop policy if exists tags_all    on public.tags;
drop policy if exists tags_select on public.tags;
drop policy if exists tags_write  on public.tags;

-- 讀：同專案成員都看得到
create policy tags_select on public.tags for select
  using (public.is_trip_member(trip_id));

-- 寫：維持本人限定。標籤是「使用者 × 專案」的，別人不能動你的分類。
-- FOR ALL 的 USING 也會套到 SELECT，但 permissive policy 是 OR 起來的，
-- 讀取以上面那條寬的為準，不會互相打架。
create policy tags_write on public.tags for all
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

commit;

-- 驗證：應該剛好回兩列 tags_select 與 tags_write，沒有 tags_all
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'tags' order by policyname;
