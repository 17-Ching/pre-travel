// 行李清單（v2.15.0）。資料是一棵樹：群組底下可以有群組或物品，物品底下不能再掛東西。
// 存的時候攤平成一列一列（parent_id 指向父群組），這裡放純函式，scripts/check.mjs 會驗。

// 群組最多三層：手機很窄，每多一層就再縮排一次，四層之後物品名稱會被擠到看不清楚
export const MAX_DEPTH = 3

// 新旅程第一次打開行李頁時放進去的預設清單。行動電源一定要放隨身（托運會被攔下來）
export const DEFAULT_PACKING = [
  ['隨身行李', [
    ['證件與錢', ['護照', '機票／登機證', '入境資料（Visit Japan Web 等）', '錢包', '信用卡', '外幣現金']],
    ['電子用品', ['手機', '充電器', '充電線', '行動電源', '轉接頭', '耳機']],
    '眼鏡／隱形眼鏡', '常備藥', '口罩',
  ]],
  ['托運行李', [
    ['衣物', ['上衣', '褲子', '內衣褲', '襪子', '睡衣', '外套']],
    ['盥洗包', ['牙刷牙膏', '洗面乳', '保養品', '化妝品', '隱形眼鏡藥水']],
    '雨傘', '拖鞋', '購物袋',
  ]],
]

// 預設清單 → 一列一列的 node。父節點排在子節點前面（後端照順序插入，外鍵才對得上）
export function fromTemplate(tree, makeId) {
  const out = []
  const walk = (list, parentId) => list.forEach((x, i) => {
    const id = makeId()
    if (Array.isArray(x)) {
      out.push({ id, parentId, kind: 'group', title: x[0], qty: null, order: i })
      walk(x[1], id)
    } else out.push({ id, parentId, kind: 'item', title: x, qty: null, order: i })
  })
  walk(tree, null)
  return out
}

// 把另一趟的清單複製成新的一份：換新 id、父子關係重新對應、打勾全部清掉
export function cloneNodes(nodes, makeId) {
  const ids = new Map(nodes.map(n => [n.id, makeId()]))
  const out = []
  const walk = parentId => nodes.filter(n => n.parentId === parentId).sort((a, b) => a.order - b.order).forEach(n => {
    out.push({ id: ids.get(n.id), parentId: parentId && ids.get(parentId), kind: n.kind, title: n.title, qty: n.qty ?? null, order: n.order })
    walk(n.id)
  })
  walk(null)
  return out
}

// 某個群組底下（含子孫）的物品打包進度
export function progress(nodes, groupId) {
  let done = 0, total = 0
  const walk = id => nodes.forEach(n => {
    if (n.parentId !== id) return
    if (n.kind === 'item') { total++; if (n.packed) done++ } else walk(n.id)
  })
  walk(groupId)
  return { done, total }
}

// 某個節點和它底下的全部子孫（刪群組時本地要一起拿掉，資料庫是 on delete cascade）
export function subtree(nodes, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true }
  }
  return out
}
