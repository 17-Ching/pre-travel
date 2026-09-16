// F-14 / F-28：連結預覽與預覽圖取得。這是整個後端唯一要自己寫的一支。
//
// 回傳格式刻意跟前端原本的 fetchPreview() 一模一樣：{ title, description, image }，
// image 是 data URL，前端拿到後走既有的 shrinkImage() 壓縮再上傳 bucket，
// 不需要在這裡放任何 Supabase 金鑰。
//
// 本機測試要用 `vercel dev`，Vite 的 dev server 不會跑 /api。
import { lookup } from 'node:dns/promises'
import net from 'node:net'

const TIMEOUT = 5000
const MAX_PAGE = 2 * 1024 * 1024
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_HOPS = 5
const UA = 'Mozilla/5.0 (compatible; OnwayBot/1.0; +link preview)'

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)   // CGNAT
    || (a === 169 && b === 254)             // link-local
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0))
    || (a === 198 && (b === 18 || b === 19)) // benchmark
}

function isBlocked(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip)
  const s = ip.toLowerCase()
  if (s.startsWith('::ffff:')) {
    const v4 = s.slice(7)
    return net.isIPv4(v4) ? isPrivateV4(v4) : true
  }
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s)
}

// 每一跳轉址都重新解析一次，因為轉址目標可能指回內網。
// ponytail: 解析後仍用 hostname 連線，理論上擋不掉 DNS rebinding。
// 要根治得自己接 socket 綁 IP 並保留 SNI/Host，對這個規模不值得。
async function assertPublic(hostname) {
  const addrs = await lookup(hostname, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error('dns')
  if (addrs.some(a => isBlocked(a.address))) throw new Error('blocked')
}

async function safeFetch(url, ac) {
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(current)
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocol')
    if (u.username || u.password) throw new Error('protocol')
    await assertPublic(u.hostname)
    const res = await fetch(current, {
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh,ja,en' },
    })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      res.body?.cancel()
      current = new URL(loc, current).toString()
      continue
    }
    return { res, url: current }
  }
  throw new Error('too_many_redirects')
}

async function readCapped(res, max) {
  if (Number(res.headers.get('content-length')) > max) throw new Error('too_large')
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { await reader.cancel(); throw new Error('too_large') }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function withTimeout(fn) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  try { return await fn(ac) } finally { clearTimeout(timer) }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
  return Number.isFinite(n) ? String.fromCodePoint(n) : m
})

function meta(html, prop) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i'))?.[0]
  const val = tag?.match(/content=["']([^"']*)["']/i)?.[1]
  return val ? decode(val).trim() : ''
}

// 日文網站不少還是 Shift_JIS / EUC-JP，用 UTF-8 硬解會整片亂碼
function toText(buf, contentType) {
  let cs = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
  let html = new TextDecoder('utf-8').decode(buf)
  if (!cs) cs = html.slice(0, 4096).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  if (cs && !/^utf-?8$/i.test(cs)) {
    try { html = new TextDecoder(cs).decode(buf) } catch { /* 不認得的編碼就留 UTF-8 */ }
  }
  return html
}

async function grabImage(src) {
  return withTimeout(async ac => {
    const { res } = await safeFetch(src, ac)
    if (!res.ok) throw new Error('image_status')
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim()
    if (!mime.startsWith('image/')) throw new Error('not_image')
    const buf = await readCapped(res, MAX_IMAGE)
    return `data:${mime};base64,${buf.toString('base64')}`
  })
}

export default async function handler(req, res) {
  const target = (req.query?.url || '').trim()
  if (!target) return res.status(400).json({ error: 'missing_url' })

  let page
  try {
    page = await withTimeout(async ac => {
      const { res: r, url } = await safeFetch(target, ac)
      if (!r.ok) throw new Error('status_' + r.status)
      const ct = r.headers.get('content-type') || ''
      // F-28：使用者也可能直接貼圖片網址，那就沒有 OG 可以解，整包當圖片回去
      if (ct.startsWith('image/')) {
        const buf = await readCapped(r, MAX_IMAGE)
        return { image: `data:${ct.split(';')[0].trim()};base64,${buf.toString('base64')}`, url }
      }
      if (!/text\/html|application\/xhtml/i.test(ct)) throw new Error('not_html')
      return { html: toText(await readCapped(r, MAX_PAGE), ct), url }
    })
  } catch (e) {
    const msg = String(e?.message || e)
    const code = msg === 'blocked' || msg === 'protocol' ? 403 : 502
    return res.status(code).json({ error: msg === 'blocked' ? 'blocked' : 'unreachable' })
  }

  // 直接貼圖片網址的情況：沒有標題也沒有描述，只有圖
  if (page.image) {
    res.setHeader('cache-control', 'public, max-age=600')
    return res.status(200).json({ title: '', description: '', image: page.image })
  }

  const title = meta(page.html, 'og:title')
    || decode(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
    || new URL(page.url).hostname.replace(/^www\./, '')
  const description = meta(page.html, 'og:description') || meta(page.html, 'description')

  let image = ''
  const src = meta(page.html, 'og:image') || meta(page.html, 'twitter:image')
  if (src) {
    try { image = await grabImage(new URL(src, page.url).toString()) } catch { /* 沒圖也要回標題 */ }
  }

  // 預覽結果會變（店家改 OG），但十分鐘內重貼同一個連結不需要再抓一次
  res.setHeader('cache-control', 'public, max-age=600')
  res.status(200).json({ title, description, image })
}

// 給 scripts/check.mjs 用，Vercel 只會用到 default export
export { isBlocked, meta, decode, toText }

