import { createRouter, createWebHistory } from 'vue-router'
import { store, bootstrap } from './store'

// 只跑一次，之後每次導航都等同一個 promise
const ready = bootstrap()
import Login from './pages/Login.vue'
import Trips from './pages/Trips.vue'
import TripForm from './pages/TripForm.vue'
import Trip from './pages/Trip.vue'
import ItemForm from './pages/ItemForm.vue'
import ItemDetail from './pages/ItemDetail.vue'
import Members from './pages/Members.vue'
import Regions from './pages/Regions.vue'
import Tags from './pages/Tags.vue'
import Invite from './pages/Invite.vue'
import Profile from './pages/Profile.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },                                // P-01
    { path: '/', component: Trips },                                     // P-02
    { path: '/profile', component: Profile },                            // P-11 個人資料
    { path: '/trips/new', component: TripForm },                         // P-03
    { path: '/trips/:tripId/edit', component: TripForm },                // P-03
    { path: '/trips/:tripId', component: Trip },                         // P-04
    { path: '/trips/:tripId/items/new', component: ItemForm },           // P-05
    { path: '/trips/:tripId/items/:itemId/edit', component: ItemForm },  // P-05
    { path: '/trips/:tripId/items/:itemId', component: ItemDetail },     // P-06
    { path: '/trips/:tripId/members', component: Members },              // P-07
    { path: '/trips/:tripId/regions', component: Regions },              // P-08
    { path: '/trips/:tripId/tags', component: Tags },                    // P-09
    { path: '/invite/:token', component: Invite },                       // P-10
  ],
  // 換頁從最上面開始。vue-router 預設完全不碰捲軸，所以清單捲到一半按新增，
  // 表單頁會停在同一個捲動位置 —— 使用者看到的是半截或整片空白。
  // 這影響每一條路由，不是只有新增，所以修在這裡而不是各頁自己捲。
  //
  // savedPosition 只有上一頁／下一頁才有值，所以「編輯完按返回」「看完詳情返回」
  // 會回到原本看的地方，不會把人丟回清單頂端重找。
  scrollBehavior: (to, from, savedPosition) => savedPosition ?? { top: 0 },
})

// F-01：未登入導去登入頁，登入後回原本要開的網址。
// 一定要先等 bootstrap 讀完既有的 session，否則重新整理時 store.me 還是 null，
// 已登入的人會被自己的守衛踢回登入頁。
router.beforeEach(async to => {
  await ready
  if (!store.me && to.path !== '/login') return { path: '/login', query: { redirect: to.fullPath } }
  if (store.me && to.path === '/login') return '/'
})
