<script setup>
import { computed } from 'vue'
import { PhSun, PhMoon } from '@phosphor-icons/vue'
import { theme, THEMES } from '../store'

const ICON = { light: PhSun, dark: PhMoon }
const idx = computed(() => Math.max(0, THEMES.findIndex(([v]) => v === theme.v)))
</script>

<template>
  <div class="relative inline-grid grid-cols-2 rounded-full border border-line bg-surface-2 p-1" role="group" aria-label="外觀">
    <!-- 滑塊寬度要扣掉 p-1 的左右內距，translateX(100%) 才剛好等於一格 -->
    <div aria-hidden="true"
      class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-card shadow-e1 transition-transform duration-200 ease-out"
      :style="{ transform: `translateX(${idx * 100}%)` }" />
    <button v-for="[v, l] in THEMES" :key="v" :aria-pressed="theme.v === v" @click="theme.v = v"
      :class="['relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150',
        theme.v === v ? 'text-ink' : 'text-muted']">
      <component :is="ICON[v]" :size="16" weight="bold" />{{ l }}
    </button>
  </div>
</template>
