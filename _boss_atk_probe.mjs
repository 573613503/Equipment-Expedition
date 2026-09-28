// 复现：战斗时怪物不攻击 —— 跑一场真实战斗，统计 Boss 出手日志
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}
const engine = await import('./src/engine/engine.js')
const { api, newGame } = engine
const { battles, getBattle } = await import('./src/engine/battle.js')
const C = (await import('./src/engine/content.js')).default

newGame('QA')
// 发一套传奇装备（模拟中后期玩家，堆高闪避/护盾等属性）
const st0 = (await import('./src/engine/save.js')).getState()
st0.player.wallet = { gold: 999999, gem: 999, stardust: 99 }
// 直接看 Boss 数据
const d = (await import('./src/engine/content.js')).DUNGEONS.find(x => x.id === 'dungeon_ashen_ruins')
console.log('--- boss baseStats:', JSON.stringify(d.bosses[0].baseStats))

const { battleId } = await api('/battle/start', { method: 'POST', body: { dungeonId: 'dungeon_ashen_ruins' } })
const b = getBattle(battleId)
console.log('bossInterval =', b.bossInterval, ' nextBossAtk0 =', b.nextBossAtk, ' bossAcc =', b.bossAcc)
const pst = b.player.stats
console.log('player dodge =', pst.dodge, ' accuracy =', pst.accuracy, ' def =', pst.defense, ' hp =', pst.health)

// 手动推进 300 tick（= 60 秒）
for (let i = 0; i < 300 && b.status === 'running'; i++) b.step()
const bossAtks = b.log.filter(l => l.type === 'bossAttack')
const bossMiss = b.log.filter(l => l.type === 'bossMiss')
const playerAtks = b.log.filter(l => l.type === 'playerAttack')
console.log('--- 300 ticks 后: status =', b.status, ' tick =', b.tick)
console.log('playerAttack =', playerAtks.length, ' bossAttack =', bossAtks.length, ' bossMiss(玩家闪避) =', bossMiss.length)
console.log('最后 12 条日志:')
for (const l of b.log.slice(-12)) console.log('  ', l.type, '|', l.text)
