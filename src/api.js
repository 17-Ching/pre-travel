// Supabase 存取層。只負責「送出請求」與「欄位轉換」，不碰畫面狀態。
// 資料庫是 snake_case，畫面用 camelCase，轉換全部集中在這裡，其他檔案看不到 snake_case。
import { sb } from './supabase'

// RLS 擋 UPDATE / DELETE 時不會報錯，只是靜默影響 0 筆。
// 所以每個寫入都要 .select() 回來數筆數，沒有 error 不等於成功。
function must(res, action) {
  if (res.error) throw new Error(`${action}失敗：${res.error.message}`)
  if (Array.isArray(res.data) && res.data.length === 0) {
    throw new Error(`${action}失敗：沒有權限，或資料已被其他人刪除`)
  }
  return res.data
}

// ---- 欄位轉換 ----
const toProfile = r => ({ id: r.id, username: r.username, name: r.display_name, avatar: r.avatar_url })
const toTrip = r => ({
  id: r.id, name: r.name, country: r.country_code, coverPath: r.cover_path, cover: '',
  start: r.start_date, end: r.end_date, ownerId: r.owner_id,
  deletedAt: r.deleted_at, updatedAt: r.updated_at,
})
const toMember = r => ({
  tripId: r.trip_id, userId: r.user_id, role: r.role, status: r.status,
  joinedAt: r.joined_at, leftAt: r.left_at,
})
const toRegion = r => ({ id: r.id, tripId: r.trip_id, name: r.name, order: r.sort_order })
const toTag = r => ({ id: r.id, tripId: r.trip_id, userId: r.user_id, name: r.name })
const toInvite = r => ({
  id: r.id, tripId: r.trip_id, token: r.token, createdBy: r.created_by,
  expiresAt: r.expires_at, revokedAt: r.revoked_at,
})
const toItem = r => ({
  id: r.id, tripId: r.trip_id, ownerUserId: r.owner_user_id, type: r.type, title: r.title,
  regionId: r.region_id, links: r.links ?? [], images: r.images ?? [], note: r.note ?? '',
  visited: r.visited, status: r.purchase_status, plannedStore: r.planned_store ?? '',
  tagIds: [], createdBy: r.created_by, updatedBy: r.updated_by,
  createdAt: r.created_at, updatedAt: r.updated_at,
})

// Postgres 的 time 回來是 'HH:MM:SS'，畫面只要 'HH:MM'。
// D8 說不做時區換算，所以整條路徑都當字串處理 —— 一旦轉成 Date，
// 某個環節就會把它當本地時間再偏移一次，在台灣排、在日本看就會差幾小時。
const hhmm = t => (t ? String(t).slice(0, 5) : '')

const toEntry = r => ({
  id: r.id, tripId: r.trip_id, date: r.date, endDate: r.end_date, section: r.section, slot: r.slot,
  kind: r.kind, itemId: r.item_id, title: r.title ?? '',
  transportMode: r.transport_mode ?? '',
  startTime: hhmm(r.start_time), endTime: hhmm(r.end_time),
  links: r.links ?? [], note: r.note ?? '', done: r.done, order: r.sort_order,
  passengerIds: r.passenger_ids ?? [],
  detachedAt: r.detached_at,
  createdBy: r.created_by, updatedBy: r.updated_by,
  createdAt: r.created_at, updatedAt: r.updated_at,
})

const entryRow = e => ({
  trip_id: e.tripId,
  date: e.date,
  end_date: e.kind === 'stay' ? e.endDate : null,
  section: e.section,
  slot: e.slot,
  kind: e.kind ?? 'place',
  item_id: e.itemId || null,
  title: (e.title ?? '').slice(0, 100),
  links: (e.links ?? []).filter(l => l.url?.trim()),
  transport_mode: (e.transportMode ?? '').slice(0, 30),
  start_time: e.startTime || null,
  end_time: e.endTime || null,
  note: (e.note ?? '').slice(0, 2000),
  passenger_ids: e.passengerIds ?? [],
  done: Boolean(e.done),
  sort_order: e.order ?? 0,
})

const toDay = r => ({ tripId: r.trip_id, date: r.date, note: r.note ?? '', updatedBy: r.updated_by, updatedAt: r.updated_at })

// 寫回資料庫時只留欄位本身，畫面加上去的東西（簽名網址）要剝掉
const itemRow = i => ({
  trip_id: i.tripId,
  owner_user_id: i.ownerUserId ?? null,
  type: i.type,
  title: i.title.trim().slice(0, 100),
  region_id: i.regionId || null,
  links: (i.links ?? []).filter(l => l.url?.trim()),
  // thumbPath 一定要跟著寫回去，這是 jsonb，漏一個欄位就等於永久丟掉那張縮圖
  images: (i.images ?? []).map(({ path, thumbPath, w, h }) => ({ path, thumbPath, w, h })),
  note: (i.note ?? '').slice(0, 2000),
  visited: Boolean(i.visited),
  purchase_status: i.status ?? 'todo',
  planned_store: (i.plannedStore ?? '').slice(0, 100),
})

// ---- 讀取 ----
// 一次把使用者看得到的東西全部載回來，store 就能維持成一份完整的本地鏡像，
// 頁面繼續用同步的方式讀。RLS 已經把範圍限制在他參與的專案裡，
// 朋友等級的資料量這樣最省事，也直接鋪好離線快取（F-32）的路。
export async function loadAll() {
  const [profiles, trips, members, regions, tags, items, itemTags, invites, entries, days] = await Promise.all([
    sb().from('profiles').select('*'),
    sb().from('trips').select('*'),
    sb().from('trip_members').select('*'),
    sb().from('regions').select('*'),
    sb().from('tags').select('*'),
    sb().from('items').select('*'),
    sb().from('item_tags').select('*'),
    sb().from('invites').select('*'),
    sb().from('itinerary_entries').select('*'),
    sb().from('trip_days').select('*'),
  ])
  for (const r of [profiles, trips, members, regions, tags, items, itemTags, invites, entries, days]) {
    if (r.error) throw new Error('載入資料失敗：' + r.error.message)
  }

  const mapped = items.data.map(toItem)
  const byId = new Map(mapped.map(i => [i.id, i]))
  for (const t of itemTags.data) byId.get(t.item_id)?.tagIds.push(t.tag_id)

  return {
    users: profiles.data.map(toProfile),
    trips: trips.data.map(toTrip),
    members: members.data.map(toMember),
    regions: regions.data.map(toRegion),
    tags: tags.data.map(toTag),
    items: mapped,
    invites: invites.data.map(toInvite),
    entries: entries.data.map(toEntry),
    days: days.data.map(toDay),
  }
}

// ---- 圖片 ----
// media 是私有 bucket，要簽名網址才看得到。一次簽一批，不要每張打一次。
export async function signPaths(paths) {
  const uniq = [...new Set(paths.filter(Boolean))]
  if (!uniq.length) return new Map()
  const { data, error } = await sb().storage.from('media').createSignedUrls(uniq, 3600)
  if (error) return new Map()
  return new Map(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]))
}

export async function uploadImage(tripId, blob) {
  const path = `${tripId}/${crypto.randomUUID()}.jpg`
  const { error } = await sb().storage.from('media').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error('圖片上傳失敗：' + error.message)
  return path
}

// 頭像放公開 bucket，免簽名，換頭像時直接覆蓋同一個路徑
export async function uploadAvatar(userId, blob) {
  const path = `${userId}/avatar.jpg`
  const { error } = await sb().storage.from('avatars')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error('頭像上傳失敗：' + error.message)
  const { data } = sb().storage.from('avatars').getPublicUrl(path)
  // 加上時間戳，否則換了頭像瀏覽器還是拿舊的快取
  return `${data.publicUrl}?v=${Date.now()}`
}

// ---- 個人資料 ----
export async function saveProfile(id, { name, avatar }) {
  const rows = must(await sb().from('profiles')
    .update({ display_name: name, avatar_url: avatar })
    .eq('id', id).select(), '更新個人資料')
  return toProfile(rows[0])
}

// ---- 專案 ----
export async function createTrip({ name, country, start, end, coverPath }) {
  const { data, error } = await sb().rpc('create_trip', {
    p_name: name, p_country: country, p_start: start || null, p_end: end || null, p_cover: coverPath || null,
  })
  if (error) throw new Error('建立專案失敗：' + error.message)
  return data
}

export async function updateTrip(id, { name, country, start, end, coverPath }) {
  const rows = must(await sb().from('trips').update({
    name: name.trim().slice(0, 50), country_code: country.toUpperCase(),
    start_date: start || null, end_date: end || null, cover_path: coverPath || null,
  }).eq('id', id).select(), '更新專案')
  return toTrip(rows[0])
}

// 軟刪除一定要走 RPC：直接 update deleted_at 會被自己的 select 政策擋掉
export async function deleteTrip(id) {
  const { error } = await sb().rpc('delete_trip', { p_trip_id: id })
  if (error) throw new Error('刪除專案失敗：' + error.message)
}

// ---- 地區 ----
// id 由前端產生。畫面先樂觀地插入本地，再把同一個 id 送上來，
// 兩邊才指向同一筆，失敗時也才知道要移除哪一筆。
export async function addRegion(tripId, name, order, id) {
  const { data, error } = await sb().from('regions')
    .insert({ id, trip_id: tripId, name, sort_order: order }).select().single()
  if (error) {
    throw new Error(error.code === '23505' ? '已有同名地區' : '新增地區失敗：' + error.message)
  }
  return toRegion(data)
}
export async function renameRegion(id, name) {
  const res = await sb().from('regions').update({ name }).eq('id', id).select()
  if (res.error?.code === '23505') throw new Error('已有同名地區')
  return toRegion(must(res, '地區改名')[0])
}
export async function setRegionOrder(pairs) {
  for (const [id, order] of pairs) {
    must(await sb().from('regions').update({ sort_order: order }).eq('id', id).select(), '地區排序')
  }
}
export async function deleteRegion(id) {
  must(await sb().from('regions').delete().eq('id', id).select(), '刪除地區')
}

// ---- 標籤 ----
export async function addTag(tripId, userId, name, id) {
  const { data, error } = await sb().from('tags')
    .insert({ id, trip_id: tripId, user_id: userId, name }).select().single()
  if (error) throw new Error(error.code === '23505' ? '已有同名標籤' : '新增標籤失敗：' + error.message)
  return toTag(data)
}
export async function renameTag(id, name) {
  const res = await sb().from('tags').update({ name }).eq('id', id).select()
  if (res.error?.code === '23505') throw new Error('已有同名標籤')
  return toTag(must(res, '標籤改名')[0])
}
export async function deleteTag(id) {
  must(await sb().from('tags').delete().eq('id', id).select(), '刪除標籤')
}

// ---- 項目 ----
// 標籤關聯是另一張表，用「先刪掉不要的、再補上新的」做，比整批重寫少踩 RLS
async function syncItemTags(itemId, tagIds, previous = []) {
  const add = tagIds.filter(t => !previous.includes(t))
  const remove = previous.filter(t => !tagIds.includes(t))
  if (remove.length) {
    const { error } = await sb().from('item_tags').delete().eq('item_id', itemId).in('tag_id', remove)
    if (error) throw new Error('移除標籤失敗：' + error.message)
  }
  if (add.length) {
    const { error } = await sb().from('item_tags').insert(add.map(tag_id => ({ item_id: itemId, tag_id })))
    if (error) throw new Error('加上標籤失敗：' + error.message)
  }
}

export async function createItem(data, userId) {
  const { data: row, error } = await sb().from('items')
    .insert({ id: data.id, ...itemRow(data), created_by: userId }).select().single()
  if (error) throw new Error('新增項目失敗：' + error.message)
  await syncItemTags(row.id, data.tagIds ?? [])
  return { ...toItem(row), tagIds: [...(data.tagIds ?? [])] }
}

export async function updateItem(data, previousTagIds) {
  const rows = must(await sb().from('items').update(itemRow(data)).eq('id', data.id).select(), '儲存項目')
  await syncItemTags(data.id, data.tagIds ?? [], previousTagIds)
  return { ...toItem(rows[0]), tagIds: [...(data.tagIds ?? [])] }
}

export async function patchItem(id, patch) {
  const row = {}
  if ('visited' in patch) row.visited = patch.visited
  if ('status' in patch) row.purchase_status = patch.status
  const rows = must(await sb().from('items').update(row).eq('id', id).select(), '更新狀態')
  return toItem(rows[0])
}

export async function deleteItem(id) {
  must(await sb().from('items').delete().eq('id', id).select(), '刪除項目')
}

// ---- 行程 ----
// 一次收多筆是必要的，不是最佳化：F-41 可以多選一次加入好幾間店，
// 拆成好幾次往返的話中途失敗會留下一半，使用者看到的是加了一半的行程。
export async function createEntries(list, userId) {
  const rows = list.map(e => ({ id: e.id, ...entryRow(e), created_by: userId }))
  const { data, error } = await sb().from('itinerary_entries').insert(rows).select()
  if (error) throw new Error('加入行程失敗：' + error.message)
  return data.map(toEntry)
}

export async function updateEntry(id, patch) {
  const row = {}
  if ('title' in patch) row.title = (patch.title ?? '').slice(0, 100)
  if ('transportMode' in patch) row.transport_mode = (patch.transportMode ?? '').slice(0, 30)
  if ('startTime' in patch) row.start_time = patch.startTime || null
  if ('endTime' in patch) row.end_time = patch.endTime || null
  if ('links' in patch) row.links = (patch.links ?? []).filter(l => l.url?.trim())
  if ('note' in patch) row.note = (patch.note ?? '').slice(0, 2000)
  if ('passengerIds' in patch) row.passenger_ids = patch.passengerIds ?? []
  if ('kind' in patch) row.kind = patch.kind
  if ('done' in patch) row.done = patch.done
  if ('date' in patch) row.date = patch.date
  if ('endDate' in patch) row.end_date = patch.endDate || null
  if ('section' in patch) row.section = patch.section
  if ('slot' in patch) row.slot = patch.slot
  if ('order' in patch) row.sort_order = patch.order
  const rows = must(await sb().from('itinerary_entries').update(row).eq('id', id).select(), '儲存行程')
  return toEntry(rows[0])
}

export async function setEntryOrder(pairs) {
  for (const [id, order] of pairs) {
    must(await sb().from('itinerary_entries').update({ sort_order: order }).eq('id', id).select(), '行程排序')
  }
}

export async function deleteEntry(id) {
  must(await sb().from('itinerary_entries').delete().eq('id', id).select(), '刪除行程項目')
}

// 每日備註沒有備註就不該有資料列，所以用 upsert 而不是先查再決定
export async function saveDayNote(tripId, date, note, userId) {
  const { data, error } = await sb().from('trip_days')
    .upsert({ trip_id: tripId, date, note: (note ?? '').slice(0, 500), updated_by: userId, updated_at: new Date().toISOString() },
            { onConflict: 'trip_id,date' })
    .select().single()
  if (error) throw new Error('儲存當天備註失敗：' + error.message)
  return toDay(data)
}

export async function deleteDayNote(tripId, date) {
  const { error } = await sb().from('trip_days').delete().eq('trip_id', tripId).eq('date', date)
  if (error) throw new Error('清除當天備註失敗：' + error.message)
}

// ---- 邀請與成員 ----
export async function createInvite(tripId, userId, id, token) {
  const { data, error } = await sb().from('invites')
    .insert({ id, trip_id: tripId, token, created_by: userId }).select().single()
  if (error) throw new Error('產生邀請連結失敗：' + error.message)
  return toInvite(data)
}
export async function revokeInvite(id) {
  must(await sb().from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', id).select(), '撤銷邀請')
}
export async function invitePreview(token) {
  const { data, error } = await sb().rpc('invite_preview', { p_token: token })
  if (error) throw new Error('讀取邀請失敗：' + error.message)
  return data
}
export async function acceptInvite(token) {
  const { data, error } = await sb().rpc('accept_invite', { p_token: token })
  if (error) throw new Error(error.message === 'invite_invalid' ? '邀請已失效' : '加入失敗：' + error.message)
  return data
}
export async function setMemberStatus(tripId, userId, status) {
  must(await sb().from('trip_members')
    .update({ status, left_at: status === 'left' ? new Date().toISOString() : null })
    .eq('trip_id', tripId).eq('user_id', userId).select(), '更新成員')
}
