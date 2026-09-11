import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // host: true → 綁 0.0.0.0，同一個 Wi-Fi 的手機可以用電腦的區網 IP 開。
  server: { host: true, port: Number(process.env.PORT) || 5173 },
})
