// 帳號密碼的驗證規則。唯一定義在這裡，supabase.js 從這裡 re-export。
//
// 刻意獨立成一個檔案、不 import Supabase SDK：驗證規則是純邏輯，
// 不該跟「有沒有設定後端連線」綁在一起。UI 只想檢查一個帳號格式對不對時，
// 不必為此把整個 SDK 和環境變數的需求一起拉進來。

// 帳號限 3 到 20 個字，只能用英數字和底線
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
export const MIN_PASSWORD = 6

// 帳號不分大小寫：Jean 和 jean 是同一個帳號
export const normalizeUsername = u => u.trim().toLowerCase()

export function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username.trim())) return '帳號限 3 到 20 個字，只能用英數字和底線'
  if (password.length < MIN_PASSWORD) return `密碼至少 ${MIN_PASSWORD} 個字`
  return ''
}
