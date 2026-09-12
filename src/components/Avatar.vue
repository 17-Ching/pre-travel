<script setup>
import { computed } from 'vue'
import { tagHue } from '../store'
const props = defineProps({ user: Object, size: { type: Number, default: 28 } })
// 帳號密碼註冊的人沒有頭像，用名字第一個字頂著，不要留一個破圖。
// 配色依名字雜湊，跟標籤和旅程資料夾共用同一組 8 色，
// 這樣一整排都沒頭像時還分得出誰是誰。
const initial = computed(() => (props.user?.name || '?').trim().charAt(0).toUpperCase() || '?')
// 用 id 而不是名字：改暱稱時顏色不會跟著跳掉
const hue = computed(() => `tag tag-${tagHue(props.user?.id || props.user?.name || '')}`)
const box = computed(() => ({ width: props.size + 'px', height: props.size + 'px' }))
</script>

<template>
  <img v-if="user?.avatar" :src="user.avatar" :alt="user.name"
    class="shrink-0 rounded-full bg-line object-cover" :style="box" />
  <span v-else-if="user" :title="user.name" aria-hidden="true"
    :class="['flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none', hue]"
    :style="{ ...box, fontSize: Math.round(size * 0.42) + 'px' }">{{ initial }}</span>
</template>
