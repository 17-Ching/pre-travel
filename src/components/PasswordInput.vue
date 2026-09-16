<script setup>
// 密碼欄 + 自己的顯示切換。每個欄位各自管自己的明暗，不共用一個開關：
// 「再輸入一次」的用途就是比對自己有沒有打錯，一顆眼睛同時掀開兩欄等於少了一層檢查。
//
// 為什麼要能看見：這個 App 沒有信箱，也就沒有自助的忘記密碼流程（見 supabase.js），
// 密碼打錯一個字帳號就進不來了。
import { ref } from 'vue'
import { PhEye, PhEyeSlash } from '@phosphor-icons/vue'

defineProps({ id: String, autocomplete: { type: String, default: 'current-password' }, placeholder: String })
const model = defineModel({ type: String, required: true })
const show = ref(false)
</script>

<template>
  <div class="relative">
    <input :id="id" v-model="model" :type="show ? 'text' : 'password'" class="input pr-12"
      :autocomplete="autocomplete" :placeholder="placeholder" />
    <button type="button" class="icon-btn absolute right-1 top-1/2 size-9 -translate-y-1/2 text-muted"
      :aria-label="show ? '隱藏密碼' : '顯示密碼'" @click="show = !show">
      <component :is="show ? PhEyeSlash : PhEye" :size="18" />
    </button>
  </div>
</template>
