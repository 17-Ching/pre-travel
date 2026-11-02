// 營業時間：好幾段時段（中午休息的餐廳）＋一個公休日。純函式，scripts/check.mjs 直接測。
// 時間一律是 'HH:MM' 字串，跟行程的開始／結束時間一樣不碰 Date（D8：不做時區換算）。
//
// hours：[{ open: '11:00', close: '14:30' }, ...]
// closedDay：null（沒選，不顯示）、'none'（選了「無」，顯示全年無休）、'mon'…'sun'
export const MAX_RANGES = 6
export const CLOSED_DAYS = [
  ['mon', '週一'], ['tue', '週二'], ['wed', '週三'], ['thu', '週四'], ['fri', '週五'], ['sat', '週六'], ['sun', '週日'], ['none', '無'],
]

// 存檔前整理：只留兩格都有填的，照開始時間排。close 可以比 open 早（營業到半夜，18:00–02:00）
export const cleanHours = hours => (hours ?? [])
  .filter(r => r?.open && r?.close)
  .map(({ open, close }) => ({ open, close }))
  .sort((a, b) => a.open.localeCompare(b.open))
  .slice(0, MAX_RANGES)

// 顯示用：「11:00–14:30、17:00–21:00・週一公休」。兩樣都沒有就回空字串，畫面整列不顯示
export function fmtHours(hours, closedDay) {
  const ranges = cleanHours(hours).map(r => `${r.open}–${r.close}`).join('、')
  const closed = closedDay === 'none' ? '全年無休'
    : CLOSED_DAYS.find(([k]) => k === closedDay) ? `${CLOSED_DAYS.find(([k]) => k === closedDay)[1]}公休` : ''
  return [ranges, closed].filter(Boolean).join('・')
}
