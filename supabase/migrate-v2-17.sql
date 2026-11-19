-- v2.17.0：旅程的共用匯率（trips.exchange_rates ＋ set_exchange_rate RPC）。
-- 一整趟共用一組匯率，全隊看到的台幣換算才會一樣。
--
-- 只是加欄位，不用補表的 GRANT（GRANT 是表層級的，既有授權自動涵蓋新欄位）。
-- **但新函式要自己 grant execute** —— 2026-10-30 的授權變更只提到新資料表，
-- 新函式其實還吃得到 PostgreSQL 給 PUBLIC 的預設 EXECUTE，所以漏掉通常也會動。
-- 這裡還是明寫一份，理由同 schema.sql 第 7 節：哪天 PUBLIC 那條被收掉，
-- 沒明寫的 RPC 會整批掛掉，而那時候沒人會想到是授權的問題。
--
-- RLS 不用動。這支 RPC 是 security definer，成員檢查寫在函式裡。
--
-- 對正式庫就跑這一支，不要重跑整個 schema.sql。schema.sql 已經同步成一樣的結果。
-- 可重複執行。在 Supabase 後台 SQL Editor 貼上執行即可。

begin;

-- ── 1. 欄位 ──────────────────────────────────────────────────
-- { "JPY": { "rate": 4.84, "source": "api"|"manual", "at": …, "by": <uuid> } }
-- rate ＝ **1 台幣換多少單位外幣**（JPY 4.84、KRW 40.4、VND 814）。
-- 方向是使用者的講法（「一塊台幣換幾塊日幣」），前端換算成台幣是除的。
-- 反過來存（1 外幣換多少台幣）數字剛好是倒數，不會報錯，只會讓畫面上的金額
-- 差好幾個數量級。TWD 是基準，不存自己。
--
-- not null default '{}'：沒設過匯率的旅程讀出來就是空物件，前端不用同時處理
-- null 和 {}。舊資料吃預設值，所以**不用回填** —— 也因此不會踩到 v2.15.1
-- 那個「migration 做 UPDATE 會被 touch 觸發器清掉 updated_by」的坑
-- （trips 只有 updated_at，連 updated_by 都沒有，但這支根本不做 UPDATE）。
--
-- 內容的形狀只驗到「是不是物件」。再往下驗每個幣別的 rate / source 就得先做一個
-- immutable 函式（CHECK 裡不能寫子查詢），而寫入一律走下面那支 RPC，
-- 該驗的在那裡驗完了。
alter table public.trips add column if not exists exchange_rates jsonb not null default '{}'::jsonb;
alter table public.trips drop constraint if exists trips_exchange_rates_is_object;
alter table public.trips add constraint trips_exchange_rates_is_object
  check (jsonb_typeof(exchange_rates) = 'object');

-- ── 2. 設定匯率的 RPC ────────────────────────────────────────
-- 函式內文跟 schema.sql 那一份逐字一樣（註解也是），這樣兩邊的 prosrc md5
-- 可以直接比對，差一個字就看得出來。
create or replace function public.set_exchange_rate(
  p_trip uuid, p_currency text, p_rate numeric, p_source text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rates jsonb;
begin
  if not public.is_trip_member(p_trip) then raise exception 'not_member'; end if;

  -- 幣別與來源不管是設定還是清除都要驗。清除時 p_rate 是 null，但四個參數
  -- 一律要給 —— PostgREST 是照參數名找函式的，少給一個會變成「找不到函式」，
  -- 那個錯訊比 bad_source 難查得多。
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'bad_currency';
  end if;
  -- TWD 是基準，存 TWD→TWD 的匯率只會讓前端多一個要處理的特例
  if p_currency = 'TWD' then raise exception 'twd_is_base'; end if;
  if p_source is null or p_source not in ('api', 'manual') then
    raise exception 'bad_source';
  end if;

  -- 關鍵：一定要在**同一句 UPDATE** 裡讀 exchange_rates 再合併。
  -- 先 select 出來、再 update 寫回去的話，兩個人同時設不同幣別會互相蓋掉
  -- （典型的 lost update）。寫成一句的話 READ COMMITTED 會讓後到的那句等前一句
  -- 提交、然後**用更新後的列重算**，所以 JPY 與 KRW 兩邊都留得住。有斷言守著。
  if p_rate is null then
    -- 清除這個幣別。`-` 對不存在的 key 是沒事的，所以重複清除不會出錯。
    update public.trips
       set exchange_rates = exchange_rates - p_currency
     where id = p_trip and deleted_at is null
    returning exchange_rates into v_rates;
  else
    -- rate ＝ 1 台幣換多少外幣，所以越南盾約 814、韓元約 40、日幣約 4.8，
    -- 而歐元、英鎊那種比台幣大的幣別會落在 0.03 上下。上下限都要留得很寬。
    -- 100000 不是精算過的上界，要擋的是 0、負數與明顯打錯的數量級。
    if p_rate <= 0 or p_rate >= 100000 then raise exception 'rate_out_of_range'; end if;
    update public.trips
       set exchange_rates = exchange_rates || jsonb_build_object(
             p_currency,
             jsonb_build_object('rate', p_rate, 'source', p_source,
                                'at', now(), 'by', auth.uid()))
     where id = p_trip and deleted_at is null
    returning exchange_rates into v_rates;
  end if;

  -- is_trip_member 不看 deleted_at，所以已經軟刪除的專案會走到這裡才被擋下來。
  -- 讀都讀不到的專案不該還能寫進東西。
  if not found then raise exception 'trip_not_found'; end if;
  return v_rates;
end $$;

-- ── 3. 授權 ──────────────────────────────────────────────────
grant execute on function public.set_exchange_rate(uuid, text, numeric, text)
  to authenticated, service_role;

commit;

-- 驗證：欄位在、not null、預設空物件
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'trips' and column_name = 'exchange_rates';

-- 驗證：約束在
select conname as 約束, pg_get_constraintdef(oid) as 定義
from pg_constraint where conname = 'trips_exchange_rates_is_object';

-- 驗證：函式在，而且 authenticated 叫得動
select p.proname as 函式, p.prosecdef as 是security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated可執行
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_exchange_rate';

-- 既有資料：全部是空物件，沒有人設過匯率
select count(*) as 旅程數,
       count(*) filter (where exchange_rates <> '{}'::jsonb) as 有設匯率的
from public.trips;
