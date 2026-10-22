// 離線用的資料快照（F-32）。只存一筆：最後一次看到的整份 store 資料，下次斷網打開時拿出來顯示。
// 用 IndexedDB 不用 localStorage：localStorage 只有 5 MB 而且是同步寫入，
// 清單項目多的時候會卡住畫面、也可能直接塞爆。這裡只包 get / set / del 三支，不裝套件。
const DB = 'onway', STORE = 'kv'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req?.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

// 失敗一律吞掉：私密瀏覽、空間不足時 IndexedDB 會丟錯，離線快照只是加分，不能讓 app 跟著壞
export const getSnapshot = key => run('readonly', s => s.get(key)).catch(() => null)
export const setSnapshot = (key, value) => run('readwrite', s => s.put(value, key)).catch(() => {})
export const delSnapshot = key => run('readwrite', s => s.delete(key)).catch(() => {})
