<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhUserMinus, PhLinkSimple } from '@phosphor-icons/vue'
import { store, trip, tripMembers, user, isOwner, createInvite, revokeInvite, inviteValid, removeMember, leaveTrip, toast, fmtDate } from '../store'
import TopBar from '../components/TopBar.vue'
import Avatar from '../components/Avatar.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const t = trip(tripId)
const owner = isOwner(tripId)
const members = computed(() => tripMembers(tripId).sort((a, b) => (a.status === 'left') - (b.status === 'left') || (b.role === 'owner') - (a.role === 'owner') || a.joinedAt.localeCompare(b.joinedAt)))
const invites = computed(() => store.invites.filter(i => i.tripId === tripId && inviteValid(i)))
const link = i => `${location.origin}/invite/${i.token}`

// navigator.share / navigator.clipboard 只存在於安全環境（HTTPS 或 localhost）。
// 用區網 IP 測試時兩者都是 undefined —— 分享鍵直接不顯示，複製走舊 API 頂著。
const canShare = !!navigator.share

async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* 權限被拒，往下走備援 */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.readOnly = true
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  document.body.append(ta)
  ta.select()
  ta.setSelectionRange(0, text.length) // iOS 少了這行選不到
  let ok = false
  try { ok = document.execCommand('copy') } catch { /* 舊 API 也可能被擋 */ }
  ta.remove()
  return ok
}

async function copy(i) {
  toast(await writeClipboard(link(i)) ? '已複製連結' : '複製失敗，請長按網址手動複製')
}
function share(i) { navigator.share({ title: t.name, url: link(i) }).catch(() => {}) }
function make() { createInvite(tripId); toast('已產生邀請連結，7 天內有效') }
function revoke(i) { if (confirm('撤銷這個邀請連結？拿到連結的人將無法再加入。')) revokeInvite(i.id) }
function remove(m) { if (confirm(`將 ${user(m.userId).name} 移出專案？\n他的分頁會保留為唯讀。`)) removeMember(tripId, m.userId) }
function leave() { if (confirm('離開這個專案？你的分頁會保留給其他成員看，但你將無法再編輯。')) { leaveTrip(tripId); router.replace('/') } }
</script>

<template>
  <TopBar title="成員與邀請" back />
  <main class="grid gap-8 px-4 pb-12 pt-2">
    <section>
      <h2 class="mb-2 text-[13px] font-medium text-muted">成員</h2>
      <ul class="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        <li v-for="m in members" :key="m.userId" :class="['flex items-center gap-3 px-4 py-3', m.status === 'left' && 'opacity-50']">
          <Avatar :user="user(m.userId)" :size="36" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[15px] font-medium">{{ user(m.userId).name }}<span v-if="m.userId === store.me" class="text-muted">（你）</span></p>
            <p class="text-[12px] text-muted">{{ m.status === 'left' ? '已離開' : m.role === 'owner' ? '擁有者' : '成員' }}・{{ fmtDate(m.joinedAt) }} 加入</p>
          </div>
          <button v-if="owner && m.role !== 'owner' && m.status === 'active'" class="icon-btn text-danger" aria-label="移除成員" @click="remove(m)"><PhUserMinus :size="20" /></button>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="mb-2 text-[13px] font-medium text-muted">邀請連結</h2>
      <ul v-if="invites.length" class="grid gap-3">
        <!-- overflow-hidden 是必要的：邀請網址是 nowrap 長字串，
             它的 min-content 會沿著 li → grid 軌道往上撐，min-w-0 擋不住 -->
        <li v-for="i in invites" :key="i.id" class="overflow-hidden rounded-xl border border-line bg-card p-3">
          <!-- truncate 要掛在文字本身，掛在 flex 容器上不會生效 -->
          <p class="flex items-center gap-2 text-[13px] text-muted">
            <PhLinkSimple :size="16" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate font-mono">{{ link(i) }}</span>
          </p>
          <p class="mt-1 text-[12px] text-muted">{{ user(i.createdBy).name }} 產生，{{ fmtDate(i.expiresAt) }} 到期</p>
          <div class="mt-3 flex gap-2">
            <button class="btn-ghost h-9 flex-1 text-[14px]" @click="copy(i)">複製連結</button>
            <!-- 沒有 Web Share 就不顯示，不要放一顆按了其實只是複製的假按鈕 -->
            <button v-if="canShare" class="btn-ghost h-9 flex-1 text-[14px]" @click="share(i)">分享</button>
            <button v-if="owner || i.createdBy === store.me" class="btn-danger h-9 px-3 text-[14px]" @click="revoke(i)">撤銷</button>
          </div>
        </li>
      </ul>
      <p v-else class="mb-3 text-[14px] text-muted">目前沒有有效的邀請連結。</p>
      <button class="btn-primary mt-3 w-full" @click="make">產生邀請連結</button>
    </section>

    <button v-if="!owner" class="btn-danger" @click="leave">離開專案</button>
  </main>
</template>
