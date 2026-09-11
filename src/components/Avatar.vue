<script setup>
defineProps({ user: Object, size: { type: Number, default: 28 } })
</script>

<template>
  <img v-if="user" :src="user.avatar" :alt="user.name" class="shrink-0 rounded-full bg-line object-cover" :style="{ width: size + 'px', height: size + 'px' }" />
</template>
