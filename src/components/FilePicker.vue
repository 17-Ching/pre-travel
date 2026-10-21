<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { PhX, PhFilePdf, PhPaperclip } from '@phosphor-icons/vue'
import { toast, uploadEntryFile, openFile, sweepImages, MAX_FILE_MB } from '../store'

// 航班與住宿的 PDF（電子機票、訂房確認信）。files 陣列由呼叫端擁有，這裡直接改它。
// 跟 ImagePicker 同一套：選了就上傳，元件拆掉時把「上傳了但沒存到」的檔案清掉。
// sweepImages 只看 path，PDF 跟圖片在同一個 bucket，判斷規則一樣。
const props = defineProps({ files: Array, tripId: String })
const MAX = 5

const uploaded = []
onBeforeUnmount(() => { if (uploaded.length) sweepImages(uploaded) })

const busy = ref(false)
async function add(e) {
  const picked = [...e.target.files]
  e.target.value = ''
  busy.value = true
  for (const file of picked) {
    if (props.files.length >= MAX) { toast(`最多 ${MAX} 個檔案`); break }
    try {
      const f = await uploadEntryFile(props.tripId, file)
      uploaded.push(f.path)
      props.files.push(f)
    } catch (err) { toast(err.message || `${file.name} 上傳失敗`) }
  }
  busy.value = false
}
const sizeLabel = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
</script>

<template>
  <div>
    <span class="label">PDF 檔案（電子機票、訂房確認信，最多 {{ MAX }} 個，每個 {{ MAX_FILE_MB }} MB 以內）</span>
    <ul v-if="files.length" class="mb-2 grid gap-1.5">
      <li v-for="(f, i) in files" :key="f.path" class="flex items-center gap-2 rounded-[10px] border border-line bg-card py-1.5 pl-2.5 pr-1">
        <PhFilePdf :size="20" class="shrink-0 text-danger" />
        <button class="min-w-0 flex-1 truncate text-left text-[14px]" @click="openFile(f)">{{ f.name }}</button>
        <span class="shrink-0 text-[12px] tabular-nums text-muted">{{ sizeLabel(f.size) }}</span>
        <button class="icon-btn size-8 shrink-0 text-muted" :aria-label="`移除 ${f.name}`" @click="files.splice(i, 1)"><PhX :size="16" /></button>
      </li>
    </ul>
    <label v-if="files.length < MAX" :class="['btn-ghost h-9 w-full cursor-pointer text-[14px]', busy && 'pointer-events-none opacity-50']">
      <PhPaperclip :size="16" weight="bold" />{{ busy ? '上傳中…' : '加 PDF' }}
      <input type="file" accept="application/pdf" multiple class="hidden" :disabled="busy" @change="add" />
    </label>
  </div>
</template>
