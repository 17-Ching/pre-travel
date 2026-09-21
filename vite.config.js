import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// 畫面上的版本號跟著 package.json 走，不要在元件裡再寫死一份 —— 兩份遲早會對不上，
// 而且對不上的時候沒人會發現（畫面顯示的那個才是使用者回報問題時會講的數字）。
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// npm run dev 也要能測 /api/preview（F-14）。
// Vite 不會跑 api 資料夾，沒有這段的話 /api/preview 會落到 SPA fallback，
// 回一頁 HTML 而且狀態碼是 200 —— 前端的 res.ok 為真、res.json() 才炸，
// 畫面上看起來就是「預覽壞掉」，而不是「本機沒有這支 API」。debug 超久。
// 這裡只是把 Vercel function 的 req/res 介面補上，邏輯還是 api/preview.js 那一份。
const apiDev = () => ({
  name: 'api-dev',
  configureServer(server) {
    server.middlewares.use('/api/preview', async (req, res) => {
      res.status = c => { res.statusCode = c; return res }
      res.json = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
      req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams)
      try {
        const { default: handler } = await server.ssrLoadModule('/api/preview.js')
        await handler(req, res)
      } catch (err) {
        server.config.logger.error('[api-dev] ' + err.message)
        res.status(500).json({ error: 'unreachable' })
      }
    })
  },
})

export default defineConfig({
  plugins: [vue(), tailwindcss(), apiDev()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // host: true → 綁 0.0.0.0，同一個 Wi-Fi 的手機可以用電腦的區網 IP 開。
  server: { host: true, port: Number(process.env.PORT) || 5173 },
})
