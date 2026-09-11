import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，請看 .env.example')

// anon key 本來就會被送到瀏覽器，它不是祕密。真正的防線是資料庫的 RLS。
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// F-01：登入後回到原本要開的網址
export function signInWithGoogle(redirectPath = '/') {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: new URL(redirectPath, location.origin).toString() },
  })
}

export const signOut = () => supabase.auth.signOut()

// media 是私有 bucket，要簽名網址才看得到。一小時夠一次瀏覽，離線快取另外存。
export async function signedUrl(path, seconds = 3600) {
  if (!path) return ''
  const { data } = await supabase.storage.from('media').createSignedUrl(path, seconds)
  return data?.signedUrl ?? ''
}
