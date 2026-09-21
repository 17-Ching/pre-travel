// 一次性清掉 media bucket 裡沒有任何資料列在引用的檔案。
//
//   npm run sweep            列出會刪什麼，不動任何東西（預設）
//   npm run sweep -- --delete  真的刪掉
//
// 為什麼需要這支：清理是 2026-09-18 才加的，在那之前刪掉的項目、換掉的封面、
// 填一半放棄的表單都在 bucket 裡留了檔。那些沒有任何程式路徑會再碰到它們。
//
// 要 service role 金鑰，因為 anon 金鑰受 RLS 限制，只看得到自己是成員的專案，
// 掃不到全部。這支只在本機手動跑，金鑰不會進到打包結果（沒有 VITE_ 前綴，
// Vite 不會把它注入瀏覽器）—— 不要把這個值放進 Vercel 的前端環境變數。
import { createClient } from '@supabase/supabase-js'
import { unusedPaths } from '../src/image-rules.js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('缺少 VITE_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。')
  console.error('把 service role 金鑰加進 .env.local（不要加 VITE_ 前綴），再跑一次。')
  process.exit(1)
}

const DELETE = process.argv.includes('--delete')
const FORCE = process.argv.includes('--force')
// 剛上傳的先放過：使用者可能正開著表單、圖上傳了但還沒按儲存。
// 這支是掃歷史殘留的，沒必要跟正在進行的操作搶。
const GRACE_HOURS = 24

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const mb = n => `${(n / 1048576).toFixed(1)} MB`

// storage 的 list 一次最多給 100 筆，而且只列單層，所以要一個資料夾一個資料夾走。
async function listAll(prefix) {
  const out = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from('media').list(prefix, { limit: 100, offset })
    if (error) throw new Error(`列出 ${prefix || '/'} 失敗：${error.message}`)
    out.push(...data)
    if (data.length < 100) break
  }
  return out
}

// 路徑第一段是 trip id，檔案都在第二層
const folders = (await listAll('')).filter(e => e.id === null)
const files = []
for (const f of folders) {
  for (const o of await listAll(f.name)) {
    if (o.id === null) continue
    files.push({ path: `${f.name}/${o.name}`, at: o.created_at, size: o.metadata?.size ?? 0 })
  }
}

// service role 繞過 RLS，所以這裡拿得到全部 —— 包含軟刪除專案底下的項目，
// 那些資料列還在，圖片就還算有人引用，不能掃掉。
const [items, trips] = await Promise.all([
  sb.from('items').select('images'),
  sb.from('trips').select('cover_path'),
])
for (const r of [items, trips]) if (r.error) throw new Error('讀取資料列失敗：' + r.error.message)

const cutoff = Date.now() - GRACE_HOURS * 3600e3
const old = files.filter(f => new Date(f.at).getTime() < cutoff)
const orphans = new Set(unusedPaths(old.map(f => f.path), items.data, trips.data.map(t => t.cover_path)))
const doomed = files.filter(f => orphans.has(f.path))

console.log(`bucket 裡 ${files.length} 個檔案，資料列引用 ${items.data.length} 個項目 / ${trips.data.length} 個專案`)
console.log(`${files.length - old.length} 個檔案在 ${GRACE_HOURS} 小時內上傳，這輪跳過`)
console.log(`沒人引用：${doomed.length} 個，共 ${mb(doomed.reduce((n, f) => n + f.size, 0))}`)

// 讀不到任何引用卻要刪掉整個 bucket，比較可能是查詢壞了而不是真的全是孤兒檔。
if (!items.data.length && doomed.length && !FORCE) {
  console.error('\n中止：一筆項目都沒讀到，卻判定整個 bucket 都是孤兒檔。')
  console.error('先確認金鑰和資料庫是對的。確定要繼續就加 --force。')
  process.exit(1)
}

if (!doomed.length) process.exit(0)
for (const f of doomed.slice(0, 20)) console.log('  ' + f.path)
if (doomed.length > 20) console.log(`  …另外 ${doomed.length - 20} 個`)

if (!DELETE) {
  console.log('\n這是預演，什麼都沒刪。加上 --delete 才會真的動手。')
  process.exit(0)
}

// remove 一次收太多會逾時，分批送
let done = 0
for (let i = 0; i < doomed.length; i += 100) {
  const batch = doomed.slice(i, i + 100).map(f => f.path)
  const { error } = await sb.storage.from('media').remove(batch)
  if (error) { console.error('刪除失敗：' + error.message); process.exit(1) }
  done += batch.length
  console.log(`已刪 ${done}/${doomed.length}`)
}
console.log('清理完成。')
