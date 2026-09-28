// 探针：黑市付费刷新后，localStorage 与 /me 返回的 gold 是否一致
import fs from 'fs'
const saveSrc = fs.readFileSync('./qa/qa-save.js', 'utf8')
const m = saveSrc.match(/setItem\("gear_rpg_save_v2",\s*(.+?)\)\s*;?\s*$/s) || saveSrc.match(/setItem\("gear_rpg_save_v2",\s*(.+)\)/)
const seed = JSON.parse(JSON.parse(m[1]))

const store = new Map()
store.set('gear_rpg_save_v2', JSON.stringify(seed))
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
}
globalThis.window = globalThis
globalThis.document = { addEventListener() {}, querySelector: () => null }

const E = await import('./src/engine/engine.js')

const goldOf = () => JSON.parse(store.get('gear_rpg_save_v2')).player.wallet.gold

await E.api('/me')
const before = goldOf()
const bm0 = await E.api('/black-market')
console.log('before gold  =', before, ' freeLeft=', bm0.freeRefreshesLeft, ' nextGold=', bm0.nextRefreshGold)
const bm1 = await E.api('/black-market/refresh', { method: 'POST', body: {} })
const afterSave = goldOf()
const me = await E.api('/me')
console.log('refresh resp = freeLeft', bm1.freeRefreshesLeft, ' nextGold', bm1.nextRefreshGold)
console.log('gold in save =', afterSave, '(delta', afterSave - before, ')')
console.log('gold via /me =', me.user.wallet.gold)
console.log('MATCH save vs /me :', afterSave === me.user.wallet.gold)
