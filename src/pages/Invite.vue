<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhWarningCircle } from '@phosphor-icons/vue'
import { invitePreview, acceptInvite, flag, countryName } from '../store'
import Avatar from '../components/Avatar.vue'

const route = useRoute(), router = useRouter()
const token = route.params.token

// 還不是成員就讀不到 trips / profiles，所以邀請頁的資料一律走 invite_preview RPC。
// token 不存在時 RPC 回 null，一律當作失效。
const state = ref('loading') // loading | invalid | ok
const info = ref(null)
const busy = ref(false)

onMounted(async () => {
  try {
    const data = await invitePreview(token)
    if (!data?.valid) return (state.value = 'invalid')
    if (data.joined) return router.replace(`/trips/${data.tripId}`)
    info.value = data
    state.value = 'ok'
  } catch {
    state.value = 'invalid'
  }
})

async function join() {
  if (busy.value) return
  busy.value = true
  const tripId = await acceptInvite(token)
  busy.value = false
  if (tripId) router.replace(`/trips/${tripId}`)
  else state.value = 'invalid'
}
</script>

<template>
  <main class="flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] text-center">
    <p v-if="state === 'loading'" class="text-muted">載入中…</p>

    <template v-else-if="state === 'invalid'">
      <PhWarningCircle :size="40" class="text-muted" />
      <h1 class="mt-4 text-[20px] font-semibold">邀請已失效</h1>
      <p class="mt-2 text-muted">請對方重新產生邀請連結。</p>
      <RouterLink to="/" class="btn-ghost mt-8">回到我的旅程</RouterLink>
    </template>

    <template v-else>
      <Avatar :user="{ name: info.inviter.name, avatar: info.inviter.avatar }" :size="64" />
      <h1 class="mt-5 text-[20px] font-semibold leading-snug">
        {{ info.inviter.name }} 邀請你加入<br />「{{ info.name }}」
      </h1>
      <p class="mt-2 text-muted">{{ flag(info.country) }} {{ countryName(info.country) }}</p>
      <div class="mt-6 flex -space-x-2">
        <Avatar v-for="(m, i) in info.members" :key="i" :user="{ id: m.name, name: m.name, avatar: m.avatar }" :size="36" class="ring-2 ring-surface" />
      </div>
      <p class="mt-2 text-[13px] text-muted">{{ info.members.map(m => m.name).join('、') }}</p>
      <button class="btn-primary mt-10 h-12 w-full max-w-[320px]" :disabled="busy" @click="join">
        {{ busy ? '加入中…' : '加入' }}
      </button>
    </template>
  </main>
</template>
