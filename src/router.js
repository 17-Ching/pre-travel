import { createRouter, createWebHistory } from 'vue-router'
import { store } from './store'
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
})

// F-01: unauthenticated → login, then back to the requested URL.
router.beforeEach(to => {
  if (!store.me && to.path !== '/login') return { path: '/login', query: { redirect: to.fullPath } }
})
