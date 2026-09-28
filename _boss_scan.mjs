// 全副本扫描：用 QA 种子档逐个开战并手动推进，统计各副本 Boss 出手次数
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: k => mem.set(k, String(v ?? null)),
  removeItem: k => mem.delete(k),
}
mem.setItem = function (k, v) { this._m ||= {}; this._m[k] = v }
// 重写干净的 localStorage
globalThis.localStorage = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
  setItem(k, v) { this._m[k] = String(v) },
  removeItem(k) { delete this._m[k] },
}
await import('./qa/qa-save.js') // 写入种子存档（中后期装备 + 效果槽）

const { api } = await import('./src/engine/engine.js')
const { battles, getBattle } = await import('./src/engine/battle.js')
const C = (await import('./src/engine/content.js')).default
const DUNGEONS = (await import('./src/engine/content.js')).DUNGEONS

const rows = []
for (const d of DUNGEONS) {
  if (d.abyss) continue
  // 清掉上一场
  for (const b of [...battles.values()]) { b.status = 'lost' }
  battles.clear()
  let b = null
  try {
    const r = await api('/battle/start', { method: 'POST', body: { dungeonId: d.id, bossIndex: 0 } })
    b = getBattle(r.battleId)
  } catch (e) { rows.push(`${d.name}: 开战失败 ${e.message}`); continue }
  for (let i = 0; i < 400 && b.status === 'running'; i++) b.step()
  const ba = b.log.filter(l => l.type === 'bossAttack' && !l.text.includes('反弹'))
  const thorn = b.log.filter(l => l.type === 'bossAttack' && l.text.includes('反弹'))
  const miss = b.log.filter(l => l.type === 'bossMiss')
  const st = b.player.stats
  rows.push(`${d.name} (${b.boss.name}) tick=${b.tick} ${b.status} | boss攻击=${ba.length} 反弹=${thorn.length} 被闪避=${miss.length} | interval=${b.bossInterval} | 玩家闪避=${st.dodge} 命中=${st.accuracy} 攻速=${st.attackSpeed}`)
}
console.log(rows.join('\n'))
