<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { PhX, PhLink, PhImage } from '@phosphor-icons/vue'
import { fetchPreview, toast, uploadItemImage, uploadImageFromDataUrl, thumbOf, sweepImages } from '../store'
import { imagePaths } from '../image-rules'

// 清單項目與行程地點共用的圖片欄（F-27 / F-28）。images 陣列由呼叫端擁有，這裡直接改它。
const props = defineProps({ images: Array, tripId: String, label: { type: String, default: '圖片（最多 5 張）' } })
const MAX = 5

// 選了圖就立刻上傳（不是等按儲存），為的是馬上看得到縮圖、而且儲存能維持瞬間完成 ——
// 五張照片改成存檔時才上傳的話，按下儲存要等好幾秒還沒有進度可看。
// 代價是「上傳了但最後沒用到」的檔案：表單裡刪掉、或整個放棄不存，檔案都已經在 bucket 裡。
// 所以這裡記下上傳過的每一個 path，元件拆掉時（離開頁面、關掉抽屜）掃一次。
// sweepImages 會先確認沒有任何活著的項目或行程在引用（存檔成功的圖這時已經在 store 裡），
// 所以「存起來的」不會被誤刪，只有真的沒人要的才清掉。
// 前提是呼叫端在拆掉這個元件「之前」就把資料寫進 store —— 兩個表單都是先存再關。
const uploaded = []
const track = im => { uploaded.push(...imagePaths([im])); return im }
onBeforeUnmount(() => { if (uploaded.length) sweepImages(uploaded) })

const busy = ref(false)
async function addFiles(e) {
  const files = [...e.target.files]
  e.target.value = ''
  busy.value = true
  for (const file of files) {
    if (props.images.length >= MAX) { toast(`最多 ${MAX} 張圖片`); break }
    if (file.size > 20 * 1024 * 1024) { toast(`${file.name} 超過 20 MB`); continue }
    try { props.images.push(track(await uploadItemImage(props.tripId, file))) } catch (err) { toast(err.message || `${file.name} 讀不到`) }
  }
  busy.value = false
}
// F-28 貼圖片網址：由後端下載再轉存，因為瀏覽器抓跨網域圖片會污染 canvas
async function addImageUrl() {
  const url = prompt('貼上圖片網址')
  if (!url) return
  if (props.images.length >= MAX) return toast(`最多 ${MAX} 張圖片`)
  busy.value = true
  try {
    const d = await fetchPreview(url)
    if (!d.image) throw new Error('這個網址沒有圖片')
    props.images.push(track(await uploadImageFromDataUrl(props.tripId, d.image)))
  } catch (err) { toast(err.message === 'blocked' ? '這個網址不允許存取' : '無法取得圖片') }
  busy.value = false
}
// F-14：連結預覽圖轉存成第一張。失敗就算了，有標題就夠用
async function addFromPreview(dataUrl) {
  if (props.images.length) return
  try { props.images.push(track(await uploadImageFromDataUrl(props.tripId, dataUrl))) } catch { /* 有標題就夠用了 */ }
}
defineExpose({ addFromPreview })
</script>

<template>
  <div>
    <span class="label">{{ label }}</span>
    <div class="grid grid-cols-4 gap-2">
      <div v-for="(im, i) in images" :key="im.path" class="relative">
        <!-- 四欄的格子只有 80px 上下，跟卡片一樣吃縮圖就好，舊資料沒有才退回原圖 -->
        <img :src="thumbOf(im)" alt="" class="aspect-square w-full rounded-lg bg-line object-cover" />
        <button class="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-surface" aria-label="移除圖片" @click="images.splice(i, 1)"><PhX :size="12" weight="bold" /></button>
      </div>
      <label v-if="images.length < MAX" :class="['flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-card text-muted', busy && 'pointer-events-none opacity-50']">
        <PhImage :size="22" /><span class="text-[11px]">{{ busy ? '處理中…' : '相簿 / 拍照' }}</span>
        <input type="file" accept="image/*" multiple class="hidden" :disabled="busy" @change="addFiles" />
      </label>
      <button v-if="images.length < MAX" class="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-card text-muted" @click="addImageUrl">
        <PhLink :size="22" /><span class="text-[11px]">貼圖片網址</span>
      </button>
    </div>
  </div>
</template>
