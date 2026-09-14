import { createClient } from '@supabase/supabase-js'
import { normalizeUsername, validateCredentials, MIN_PASSWORD } from './auth-rules'

// 驗證規則的唯一定義在 auth-rules.js（純常數、不碰 SDK，任何地方都能安全 import）。
// 這裡轉出去，讓只認得 supabase.js 的呼叫端也拿得到同一份。
export { USERNAME_RE, MIN_PASSWORD, normalizeUsername, validateCredentials } from './auth-rules'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const isConfigured = Boolean(url && key)

// 延遲建立。之前這裡在模組最上層 throw，等於任何 import 這個檔案的元件
// 都會在缺環境變數時把整個 app 弄掛在載入階段。設定是部署的事，
// 不該由 import 的人承擔，所以改成真的要連線時才檢查。
let client = null
export function sb() {
  if (!client) {
    if (!isConfigured) throw new Error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，請看 .env.example')
    client = createClient(url, key, {
      // anon key 本來就會送到瀏覽器，它不是祕密。真正的防線是資料庫的 RLS。
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  }
  return client
}

// ---- 帳號密碼登入（F-01）
// Supabase Auth 底層只認 email，所以把帳號接上一個固定的假網域。
// 使用者從頭到尾不會看到也不用輸入 email。
// 代價：沒有信箱就沒有「忘記密碼」自助流程，要在 Supabase 後台幫人重設。
// 必須是合法的頂級網域。實測 Supabase 會拒絕 @pretravel.local（Email address is invalid），
// .local 不是真的 TLD。這個網域只是拿來組出合法的 email 格式，
// Confirm email 關掉後 Supabase 不會真的寄信到這裡。
// 注意：這個值一旦有人註冊就不能再改，改了等於所有既有帳號都登不進去。
const USER_DOMAIN = 'pretravel.app'
const NOT_CONFIGURED = '還沒設定後端連線，請看 .env.example'
// 小寫化只用在登入比對的 email 上。存進 profiles 的帳號保留使用者打的原樣，
// 唯一性由 schema.sql 的 `unique index on (lower(username))` 負責，
// 所以「Jean」跟「jean」搶不到同一個帳號，但顯示出來仍然是「Jean」。
const emailFor = username => `${normalizeUsername(username)}@${USER_DOMAIN}`

// Supabase 回的是英文訊息，翻成看得懂的話
function readable(error) {
  const m = (error?.message || '').toLowerCase()
  if (m.includes('invalid login credentials')) return '帳號或密碼不對'
  if (m.includes('already registered') || m.includes('already exists')) return '這個帳號已經有人用了'
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return '目前不開放註冊，請找專案擁有者開帳號'
  if (m.includes('password')) return `密碼至少 ${MIN_PASSWORD} 個字`
  if (m.includes('rate limit') || m.includes('too many')) return '嘗試太多次，等一下再試'
  if (m.includes('failed to fetch') || m.includes('network')) return '連不上伺服器，檢查網路'
  return error?.message || '發生錯誤，請再試一次'
}

// 一律回傳 { error }：中文字串或 null，呼叫端只要看這一個欄位
export async function signUp(username, password, displayName = '') {
  const bad = validateCredentials(username, password)
  if (bad) return { error: bad }
  if (!isConfigured) return { error: NOT_CONFIGURED }
  // displayName 留空不用在這裡補：schema.sql 的 handle_new_user 觸發器會
  // coalesce(nullif(display_name,''), username)，空字串自動變成帳號名稱。
  // 前端不要再做一份 fallback，規則放兩個地方遲早會不一致。
  // username 傳原樣大小寫，留空的人才會繼承到「Jean」而不是「jean」。
  const { error } = await sb().auth.signUp({
    email: emailFor(username),
    password,
    options: { data: { username: username.trim(), display_name: displayName.trim() } },
  })
  return { error: error ? readable(error) : null }
}

export async function signIn(username, password) {
  const bad = validateCredentials(username, password)
  if (bad) return { error: bad }
  if (!isConfigured) return { error: NOT_CONFIGURED }
  const { error } = await sb().auth.signInWithPassword({ email: emailFor(username), password })
  return { error: error ? readable(error) : null }
}

export async function changePassword(next) {
  if (next.length < MIN_PASSWORD) return { error: `密碼至少 ${MIN_PASSWORD} 個字` }
  if (!isConfigured) return { error: NOT_CONFIGURED }
  const { error } = await sb().auth.updateUser({ password: next })
  return { error: error ? readable(error) : null }
}

export const signOut = () => sb().auth.signOut()

// media 是私有 bucket，要簽名網址才看得到。一小時夠一次瀏覽，離線快取另外存。
export async function signedUrl(path, seconds = 3600) {
  if (!path) return ''
  const { data } = await sb().storage.from('media').createSignedUrl(path, seconds)
  return data?.signedUrl ?? ''
}
