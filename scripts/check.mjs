// node scripts/check.mjs
// 純函式的自我檢查。有網路行為的部分（連結預覽實際抓頁面、Supabase 連線）
// 要用 `vercel dev` 和真實環境測，這裡只擋邏輯回歸。
import assert from 'node:assert/strict'
import { isBlocked, meta, decode, toText } from '../api/preview.js'
import { USERNAME_RE, MIN_PASSWORD, normalizeUsername, validateCredentials, validateNewPassword } from '../src/auth-rules.js'
import { addDays, daysBetween, coversDate, stayNights, stayDayLabel } from '../src/date-rules.js'
import { imagePaths, unusedPaths } from '../src/image-rules.js'

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

// 確認密碼：只有註冊會傳第三個參數，登入不受影響
assert.equal(validateCredentials('jean', 'secret123', 'secret123'), '')
assert.match(validateCredentials('jean', 'secret123', 'secret124'), /不一樣/)
assert.match(validateCredentials('jean', 'secret123', ''), /不一樣/, '確認欄空白不能當作通過')
assert.equal(validateCredentials('jean', 'secret123', undefined), '', '登入沒有確認欄，不該被擋')
// 帳號與密碼本身不合格時，先報那個，不要先講兩次不一樣
assert.match(validateCredentials('jean', '123', '456'), /密碼至少/)

// 改密碼共用同一份密碼規則（個人資料頁）
assert.equal(validateNewPassword('secret123', 'secret123'), '')
assert.match(validateNewPassword('123', '123'), /密碼至少/)
assert.match(validateNewPassword('secret123', 'secret124'), /不一樣/)
assert.equal(validateNewPassword('secret123'), '', '沒傳確認欄時只檢查長度')

// ── 日期與住宿（F-49）
// 跨月、跨年、閏日都要對，這三個是 addDays 最常出錯的地方
assert.equal(addDays('2026-09-30', 1), '2026-10-01')
assert.equal(addDays('2026-12-31', 1), '2027-01-01')
assert.equal(addDays('2028-02-28', 1), '2028-02-29', '2028 是閏年')
assert.equal(addDays('2026-10-01', -1), '2026-09-30')
assert.equal(daysBetween('2026-09-13', '2026-09-16'), 3)

// 9/13 入住、9/16 退房 = 住 3 晚，四天都看得到這筆
const stay = { date: '2026-09-13', endDate: '2026-09-16' }
assert.equal(stayNights(stay), 3)
for (const d of ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']) {
  assert.equal(coversDate(stay, d), true, `${d} 應該看得到這筆住宿`)
}
assert.equal(coversDate(stay, '2026-09-12'), false)
assert.equal(coversDate(stay, '2026-09-17'), false, '退房日的隔天不該再出現')

assert.equal(stayDayLabel(stay, '2026-09-13'), '入住')
assert.equal(stayDayLabel(stay, '2026-09-14'), '第 2 晚')
assert.equal(stayDayLabel(stay, '2026-09-15'), '第 3 晚')
assert.equal(stayDayLabel(stay, '2026-09-16'), '退房')

// 同日進出仍算 1 晚，不要顯示 0 晚
assert.equal(stayNights({ date: '2026-09-13', endDate: '2026-09-13' }), 1)

// ── 刪項目時清 bucket。刪錯是永久資料遺失，所以每個條件都要擋住。
const img = (n) => ({ path: `t/${n}.jpg`, thumbPath: `t/${n}-s.jpg`, w: 1600, h: 1200 })
assert.deepEqual(imagePaths([img('a'), img('b')]),
  ['t/a.jpg', 't/a-s.jpg', 't/b.jpg', 't/b-s.jpg'], '原圖和縮圖都要收進來')
assert.deepEqual(imagePaths(undefined), [], '舊資料可能沒有 images')
assert.deepEqual(imagePaths([{ path: 't/old.jpg' }]), ['t/old.jpg'], '加縮圖之前的資料沒有 thumbPath')

// 沒有別人引用 → 兩個 path 都該刪
assert.deepEqual(unusedPaths(imagePaths([img('a')]), [], []), ['t/a.jpg', 't/a-s.jpg'])

// F-12：複製品共用同一個 path，原項目被刪也絕對不能刪檔
assert.deepEqual(unusedPaths(imagePaths([img('a')]), [{ images: [img('a')] }], []), [],
  '還有項目引用同一個 path 時一張都不能刪')

// 一半被引用的情況：只刪沒人要的那個（縮圖是後來才補的，會出現這種形狀）
assert.deepEqual(
  unusedPaths(['t/a.jpg', 't/a-s.jpg'], [{ images: [{ path: 't/a.jpg' }] }], []),
  ['t/a-s.jpg'], '原圖還被引用，只能刪縮圖')

// 專案封面也算引用（軟刪除的專案還留在 store.trips，封面因此受保護）
assert.deepEqual(unusedPaths(['t/cover.jpg'], [], ['t/cover.jpg']), [])
assert.deepEqual(unusedPaths(['t/cover.jpg'], [], [null, undefined]), ['t/cover.jpg'],
  '沒設封面的專案 coverPath 是 null，不該把別人的檔案保下來')

// 同一個 path 出現兩次只回一次，不要對 storage 送重複的刪除
assert.deepEqual(unusedPaths(['t/a.jpg', 't/a.jpg'], [], []), ['t/a.jpg'])

// 空值不該變成刪除目標 —— 送空字串給 storage.remove 是未定義行為
assert.deepEqual(unusedPaths([null, undefined, ''], [], []), [])

// 編輯分支：拿掉一張圖，但那張圖正被別人的複製品共用 → 一張都不能刪。
// 這條跟上面的 F-12 是同一個規則，但資料形狀不同（多張圖、候選只有一部分沒人要），
// 而 saveItem 的編輯分支就是餵這種形狀進來。
const beforeEdit = [img('x'), img('y')]
assert.deepEqual(
  unusedPaths(imagePaths(beforeEdit), [{ images: [img('y')] }, { images: [img('x')] }], []),
  [], '留下的那張和別人共用的那張都還活著')
// 同一次編輯，但沒有人共用被拿掉的那張 → 只清那張的原圖與縮圖
assert.deepEqual(
  unusedPaths(imagePaths(beforeEdit), [{ images: [img('y')] }], []),
  ['t/x.jpg', 't/x-s.jpg'])

// 表單離開時的清理：選了圖就立刻上傳，所以「上傳了但沒存到」的檔案要收掉。
// 判斷一律是「store 裡還有沒有人引用」，存好的圖這時已經在 store 裡，不會被誤刪。
const uploaded = [...imagePaths([img('1')]), ...imagePaths([img('2')])]
assert.deepEqual(unusedPaths(uploaded, [{ images: [img('1')] }], []),
  ['t/2.jpg', 't/2-s.jpg'], '存檔前在表單裡刪掉的那張才要清')
assert.deepEqual(unusedPaths(uploaded, [], []), uploaded, '填一半離開，兩張都沒存到就都要清')
assert.deepEqual(unusedPaths(uploaded, [{ images: [img('1'), img('2')] }], []), [],
  '兩張都存起來了就一張都不能碰')

console.log('檢查通過')
