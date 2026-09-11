<script setup>
import { tagColor } from '../store'
defineProps({ name: String })
</script>

<template>
  <span :class="['inline-flex h-[22px] items-center rounded-md px-1.5 text-[11px] font-medium', tagColor(name)]">{{ name }}</span>
</template>
