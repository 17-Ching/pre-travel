-- 每日備註可以引用願望清單的「參考」（v2.7.0）：那天要拍哪幾支 reels。
-- 存 id，畫面讀參考當下的標題、照片、連結，跟 Q10 行程引用清單項目同一個概念。
-- 上一版加的 links 照用，那是使用者自己打的連結，兩者不衝突。
--
-- 「不留資料列」的條件再更新一次：備註、連結、ref_ids 三個都空才不留（F-43）。
-- 那一直是前端的刪除條件，資料庫沒有對應約束，所以這裡不用改任何東西。
--
-- 兩個判斷都決定不做，理由寫在下面，之後要補不難：
--
-- 1. 不加「刪 item 時把 id 從陣列移除」的觸發器。
--    陣列設不了外鍵，要清只能寫觸發器。但 passenger_ids 也是 uuid[]、也沒有
--    清理機制，是這個專案既有的做法；而且查不到的 id 前端就是不顯示，殘留的
--    uuid 不會被看到、不會變大、uuid 也不會被新資料重用。
--    F-47 當初為行程寫觸發器是因為要留標題快照，那是真的有行為需求，這裡沒有。
--
-- 2. 不在資料庫驗證「必須是同一個 trip 的 type = 'reference'」。
--    跨表又是陣列，CHECK 做不到，一樣得寫觸發器。前端只讓使用者選參考，
--    而且就算有人塞了別種 id 進來也不會外洩 —— 這個欄位只有 id，實際內容
--    全部要過 items 的 RLS 才讀得到。舉例：塞了別人的 gift id 進去，別人
--    還是讀不到那筆 item，畫面上什麼都不會出現。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

alter table public.trip_days add column if not exists ref_ids uuid[] not null default '{}';

commit;

-- 驗證：欄位在、預設是空陣列，而且既有資料全被填成空陣列
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'trip_days' and column_name = 'ref_ids';

select count(*) filter (where cardinality(ref_ids) > 0) as 有引用的天數,
       count(*) as 總筆數
from public.trip_days;
