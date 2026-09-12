// node scripts/check.mjs
// 純函式的自我檢查。有網路行為的部分（連結預覽實際抓頁面、Supabase 連線）
// 要用 `vercel dev` 和真實環境測，這裡只擋邏輯回歸。
import assert from 'node:assert/strict'
import { isBlocked, meta, decode, toText } from '../api/preview.js'
import { USERNAME_RE, MIN_PASSWORD, normalizeUsername, validateCredentials } from '../src/auth-rules.js'

// ── SSRF 阻擋名單（F-14）
for (const ip of [
  '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255',
  '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '198.18.0.1',
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.1.1.1',
]) assert.equal(isBlocked(ip), true, `應該擋掉 ${ip}`)

for (const ip of [
  '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.167.0.1', '100.63.0.1',
  '2404:6800:4008::200e', '::ffff:8.8.8.8',
]) assert.equal(isBlocked(ip), false, `不該擋掉 ${ip}`)

// ── OG 解析：property 在 content 前後都要抓得到
const html = `<html><head>
  <meta property="og:title" content="一蘭 &amp; 拉麵">
  <meta content="濃厚豚骨" property="og:description">
  <meta name="twitter:image" content="https://ex.test/a.jpg">
  <title>  備援標題  </title>
</head></html>`
assert.equal(meta(html, 'og:title'), '一蘭 & 拉麵')
assert.equal(meta(html, 'og:description'), '濃厚豚骨')
assert.equal(meta(html, 'twitter:image'), 'https://ex.test/a.jpg')
assert.equal(meta(html, 'og:image'), '')

// ── HTML 實體
assert.equal(decode('a&amp;b'), 'a&b')
assert.equal(decode('&#39;quoted&#39;'), "'quoted'")
assert.equal(decode('&#x4e00;'), '一')
assert.equal(decode('&unknown;'), '&unknown;')

// ── 編碼：Shift_JIS 的日文不能被當成 UTF-8
const sjis = Buffer.from([0x93, 0xfa, 0x96, 0x7b]) // 日本
assert.equal(toText(sjis, 'text/html; charset=Shift_JIS'), '日本')
assert.equal(toText(Buffer.from('<meta charset="euc-jp">', 'ascii'), 'text/html').includes('meta'), true)
assert.equal(toText(Buffer.from('東京', 'utf8'), 'text/html; charset=utf-8'), '東京')

// ── 帳號規則（F-01）
assert.equal(USERNAME_RE.test('jean'), true)
assert.equal(USERNAME_RE.test('Jean_98'), true)
assert.equal(USERNAME_RE.test('ab'), false, '短於 3 個字要擋')
assert.equal(USERNAME_RE.test('a'.repeat(21)), false, '長於 20 個字要擋')
assert.equal(USERNAME_RE.test('jean-w'), false, '連字號不在允許範圍')
assert.equal(USERNAME_RE.test('小米'), false, '中文不在允許範圍')

// 小寫化只給登入比對用，不是拿來當顯示名稱的
assert.equal(normalizeUsername('  Jean  '), 'jean')
assert.equal(normalizeUsername('JEAN'), normalizeUsername('jean'), 'Jean 和 jean 要對到同一個帳號')

assert.equal(validateCredentials('jean', 'secret123'), '')
assert.match(validateCredentials('ab', 'secret123'), /帳號/)
assert.match(validateCredentials('jean', '12345'), /密碼/)
assert.equal(validateCredentials('jean', 'x'.repeat(MIN_PASSWORD)), '', `剛好 ${MIN_PASSWORD} 個字要過`)

console.log('檢查通過')
