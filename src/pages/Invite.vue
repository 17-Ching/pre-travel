<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhWarningCircle } from '@phosphor-icons/vue'
import { store, trip, tripMembers, user, inviteValid, acceptInvite, flag, countryName } from '../store'
import Avatar from '../components/Avatar.vue'

const route = useRoute(), router = useRouter()
const token = route.params.token
const inv = store.invites.find(i => i.token === token)
const valid = inviteValid(inv) && !!trip(inv.tripId)
const t = valid ? trip(inv.tripId) : null
if (t && tripMembers(t.id).some(m => m.userId === store.me && m.status === 'active')) router.replace(`/trips/${t.id}`)

const inviter = computed(() => user(inv?.createdBy))
const members = computed(() => tripMembers(t.id).filter(m => m.status === 'active').map(m => user(m.userId)))
function join() { router.replace(`/trips/${acceptInvite(token)}`) }
</script>

<template>
  <main class="flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] text-center">
    <template v-if="!valid">
      <PhWarningCircle :size="40" class="text-muted" />
      <h1 class="mt-4 text-[20px] font-semibold">邀請已失效</h1>
      <p class="mt-2 text-muted">請對方重新產生邀請連結。</p>
      <RouterLink to="/" class="btn-ghost mt-8">回到我的旅程</RouterLink>
    </template>
    <template v-else>
      <Avatar :user="inviter" :size="64" />
      <h1 class="mt-5 text-[20px] font-semibold leading-snug">{{ inviter.name }} 邀請你加入<br />「{{ t.name }}」</h1>
      <p class="mt-2 text-muted">{{ flag(t.country) }} {{ countryName(t.country) }}</p>
      <div class="mt-6 flex -space-x-2"><Avatar v-for="u in members" :key="u.id" :user="u" :size="36" class="ring-2 ring-surface" /></div>
      <p class="mt-2 text-[13px] text-muted">{{ members.map(u => u.name).join('、') }}</p>
      <button class="btn-primary mt-10 h-12 w-full max-w-[320px]" @click="join">加入</button>
    </template>
  </main>
</template>
