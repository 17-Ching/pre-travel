<script setup>
import { useRouter } from 'vue-router'
import { PhCaretLeft } from '@phosphor-icons/vue'
// px-2 + 圖示內縮 9px = 圖示光學左緣 17px；標題 px-2 = 16px。跟內容的 gutter 對齊。
// Boolean 要排在 String 前面，否則 `<TopBar back />` 會被當成空字串（falsy），返回鍵不會出現。
defineProps({ title: String, back: { type: [Boolean, String], default: false } })
const router = useRouter()
const goBack = back => (typeof back === 'string' ? router.push(back) : router.back())
</script>

<template>
  <header class="sticky top-0 z-20 flex h-14 items-center gap-1 bg-surface px-2">
    <button v-if="back" class="icon-btn -ml-0.5" aria-label="返回" @click="goBack(back)"><PhCaretLeft :size="22" /></button>
    <div class="min-w-0 flex-1 px-2">
      <slot name="title"><h1 class="truncate text-[18px] font-semibold tracking-tight">{{ title }}</h1></slot>
    </div>
    <slot />
  </header>
</template>
