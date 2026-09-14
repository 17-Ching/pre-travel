<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhPencilSimple, PhTrash, PhCopy, PhArrowSquareOut, PhCheck } from '@phosphor-icons/vue'
import { store, item as getItem, user, setStatus, deleteItem, copyItem, toast, fmtDateTime, linkLabel, sourceLabel } from '../store'
import TopBar from '../components/TopBar.vue'
import Avatar from '../components/Avatar.vue'
import TagChip from '../components/TagChip.vue'
import Sheet from '../components/Sheet.vue'

const route = useRoute(), router = useRouter()
const tripId = route.params.tripId
const it = computed(() => getItem(route.params.itemId))
if (!it.value) router.replace(`/trips/${tripId}`)

const editable = computed(() => it.value.ownerUserId === null || it.value.ownerUserId === store.me)
const images = computed(() => it.value.images ?? [])
const region = computed(() => store.regions.find(r => r.id === it.value.regionId)?.name)
const tags = computed(() => it.value.tagIds.map(id => store.tags.find(g => g.id === id)?.name).filter(Boolean))
const links = computed(() => it.value.links ?? [])
const copying = ref(false)

// F-30: plain text with URLs turned into links. Escape first, then linkify.
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener" class="break-all text-accent underline">${u}</a>`)

function remove() {
  if (confirm(`刪除「${it.value.title}」？`)) { deleteItem(it.value.id); router.replace(`/trips/${tripId}`) }
}
function copy(target) {
  copyItem(it.value, target); copying.value = false
  toast(target === 'shared' ? '已複製到共同分頁' : '已複製到我的分頁', { label: '前往', to: { path: `/trips/${tripId}`, query: { tab: target } } })
}
const STATUS = [['todo', '未買'], ['bought', '已買'], ['not_found', '沒買到']]
</script>

<template>
  <template v-if="it">
    <TopBar :title="it.type === 'place' ? '地點' : '購物'" back>
      <button class="icon-btn" aria-label="複製到…" @click="copying = true"><PhCopy :size="22" /></button>
      <template v-if="editable && !store.offline">
        <RouterLink :to="`/trips/${tripId}/items/${it.id}/edit`" class="icon-btn" aria-label="編輯"><PhPencilSimple :size="22" /></RouterLink>
        <button class="icon-btn text-danger" aria-label="刪除" @click="remove"><PhTrash :size="22" /></button>
      </template>
    </TopBar>

    <main class="pb-12">
      <div v-if="images.length" class="rail flex snap-x snap-mandatory gap-2">
        <img v-for="im in images" :key="im.url" :src="im.url" alt="" :class="['aspect-[4/3] shrink-0 snap-center rounded-xl bg-line object-cover', images.length > 1 ? 'w-[85%]' : 'w-full']" />
      </div>

      <div class="px-4 pt-4">
        <h1 :class="['text-[22px] font-semibold leading-tight', it.status === 'bought' && 'text-muted line-through']">{{ it.title }}</h1>

        <div v-if="links.length" class="mt-4 grid gap-2">
          <a v-for="l in links" :key="l.id" :href="l.url" target="_blank" rel="noopener" class="btn-ghost w-full justify-start gap-2.5">
            <PhArrowSquareOut :size="18" class="shrink-0 text-accent" />
            <span class="min-w-0 flex-1 truncate text-left">{{ linkLabel(l) }}</span>
            <span v-if="l.title?.trim()" class="shrink-0 text-[13px] font-normal text-muted">{{ sourceLabel(l.url) }}</span>
          </a>
        </div>

        <dl class="mt-5 grid gap-3 text-[15px]">
          <div v-if="region" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">地區</dt><dd>{{ region }}</dd></div>
          <div v-if="tags.length" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">標籤</dt><dd class="flex flex-wrap gap-1"><TagChip v-for="n in tags" :key="n" :name="n" /></dd></div>
          <div v-if="it.type === 'shopping' && it.plannedStore" class="flex gap-4"><dt class="w-20 shrink-0 text-muted">預計購買</dt><dd>{{ it.plannedStore }}</dd></div>
          <div class="flex items-center gap-4">
            <dt class="w-20 shrink-0 text-muted">{{ it.type === 'shopping' ? '狀態' : '去過了嗎' }}</dt>
            <dd>
              <div v-if="it.type === 'shopping'" class="flex gap-1.5">
                <button v-for="[k, l] in STATUS" :key="k" :disabled="!editable" @click="setStatus(it, { status: k })"
                  :class="['h-8 rounded-full border px-3 text-[13px] font-medium', it.status === k ? 'border-ink bg-ink text-surface' : 'border-line text-muted']">{{ l }}</button>
              </div>
              <button v-else :disabled="!editable" @click="setStatus(it, { visited: !it.visited })"
                :class="['flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium', it.visited ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted']">
                <PhCheck :size="14" weight="bold" />{{ it.visited ? '已去過' : '還沒去' }}
              </button>
            </dd>
          </div>
        </dl>

        <p v-if="it.note" class="mt-5 whitespace-pre-line text-[15px] leading-relaxed" v-html="linkify(it.note)" />

        <p class="mt-6 flex items-center gap-1.5 text-[13px] text-muted">
          <Avatar :user="user(it.createdBy)" :size="18" />{{ user(it.createdBy)?.name }} 於 {{ fmtDateTime(it.createdAt) }} 新增
        </p>
      </div>
    </main>

    <Sheet v-model:open="copying" title="複製到…">
      <button class="row" :disabled="it.ownerUserId === store.me" @click="copy('me')">我的分頁</button>
      <button class="row" :disabled="it.ownerUserId === null" @click="copy('shared')">共同分頁</button>
    </Sheet>
  </template>
</template>
