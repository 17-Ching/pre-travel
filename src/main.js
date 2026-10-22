import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'

createApp(App).use(router).mount('#app')

// 離線（F-31 / F-32）：見 public/sw.js。開發模式不註冊 —— Vite 的熱更新跟 service worker 的快取會互相打架
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
