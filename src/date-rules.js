// 日期規則。這裡刻意不碰 Vue、不碰 store，只處理 'YYYY-MM-DD' 字串，
// 所以 node scripts/check.mjs 可以直接 import 來驗（同 auth-rules.js）。
//
// 一律用字串處理，不要用 new Date('2026-11-12')：那會被當成 UTC 午夜解析，
// 在 UTC+8 算出來就是前一天。D8 說不做時區換算，做法就是不讓 Date 碰到日期的語意。
export const WEEK = ['日', '一', '二', '三', '四', '五', '六']
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const isoOf = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
export const todayISO = () => isoOf(new Date())
export const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoOf(d) }
// Math.round 不是保險，是必要的：跨日光節約時間的時區，兩個午夜差的是 23 或 25 小時
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5)

// ---- 住宿（F-49）。一筆住宿 = 入住日 date → 退房日 endDate，中間每一天都看得到它。
export const coversDate = (s, date) => s.date <= date && date <= s.endDate
// 退房日不算一晚。同日進出（極端情況）仍算 1 晚，不要顯示 0。
export const stayNights = s => Math.max(1, daysBetween(s.date, s.endDate))
export const stayDayLabel = (s, date) =>
  date === s.date ? '入住'
  : date === s.endDate ? '退房'
  : `第 ${daysBetween(s.date, date) + 1} 晚`
