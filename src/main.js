import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'

createApp(App).use(router).mount('#app')

// 電腦上的日期欄：原生的只有點右邊那個小日曆圖示才會開，點文字是在編輯年月日某一格。
// 改成點整條都打開日曆。手機本來就是點了開滾輪，不用處理；時間欄在電腦上已經換成 TimeField
if (matchMedia('(pointer: fine)').matches) {
  document.addEventListener('click', e => {
    if (e.target.matches?.('input[type="date"]')) try { e.target.showPicker() } catch { /* 舊瀏覽器沒有 showPicker */ }
  })
}

// 離線（F-31 / F-32）：見 public/sw.js。開發模式不註冊 —— Vite 的熱更新跟 service worker 的快取會互相打架
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
