// 圖片清理規則。刻意不碰 Vue、不碰 store、不碰 Supabase，只做集合運算，
// 所以 node scripts/check.mjs 可以直接 import 來驗（同 date-rules.js、auth-rules.js）。
//
// 為什麼不能「刪項目就刪它的圖」：F-12 複製項目時，複製出來的那筆共用同一個
// bucket path，沒有另外存一份檔。刪掉原項目就把複製品的圖一起刪掉了，而且
// 那是別人分頁裡看得到的圖，刪掉就回不來 —— 孤兒檔只是浪費空間，刪錯是資料遺失。
// 加縮圖之前的舊資料沒有 thumbPath，這裡就濾掉，不要讓 undefined 流出去 ——
// 這個結果有可能被直接餵給 storage.remove()。
export const imagePaths = images => (images ?? []).flatMap(im => [im?.path, im?.thumbPath]).filter(Boolean)

// candidates 裡面，沒有任何活著的項目或專案封面還在引用的那些。
// liveItems 要傳「已經把被刪的那筆移除掉」之後的清單。
export function unusedPaths(candidates, liveItems, coverPaths = []) {
  const alive = new Set([
    ...(liveItems ?? []).flatMap(i => imagePaths(i.images)),
    ...(coverPaths ?? []),
  ].filter(Boolean))
  return [...new Set(candidates.filter(p => p && !alive.has(p)))]
}
