// F-14 連結預覽的共用狀態機。清單（ItemForm）與行程（Itinerary）兩邊都要，
// 差別只在抓到之後各自還要填什麼，所以這裡只負責「抓」與「記狀態」，
// 填標題以外的事由呼叫端拿回傳值自己做。
import { ref } from 'vue'
import { fetchPreview } from './store'

export function useLinkPreview() {
  const previews = ref({}) // linkId -> { state: 'loading' | 'ok' | 'fail', url, data }

  // 只填「還空著」的欄位，所以不需要覆蓋確認。同一個網址不重抓。
  async function load(l) {
    const url = l.url.trim()
    if (!url || url === previews.value[l.id]?.url) return null
    previews.value[l.id] = { state: 'loading', url }
    try {
      const data = await fetchPreview(url)
      previews.value[l.id] = { state: 'ok', url, data }
      if (!l.title.trim()) l.title = data.title
      return data
    } catch {
      previews.value[l.id] = { state: 'fail', url }
      return null
    }
  }

  return { previews, load }
}
