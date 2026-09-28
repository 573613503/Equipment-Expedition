// 效果 CD + 护盾削弱验收：
// 1) 所有效果槽 fx.cooldownTicks > 0（老存档 cooldownTicks=0 也要被结局下限兜住）
// 2) 护盾值 = maxHp × mag × 0.6（削弱后）
// 3) 同一效果两次触发间隔 ≥ 其 CD（不允许 0CD 无缝触发）
// 4) effectMetaText 描述里冷却不再是 0 秒
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}
const { api, newGame } = await import('./src/engine/engine.js')
const { battles } = await import('./src/engine/battle.js')
const { getState } = await import('./src/engine/save.js')
const { DUNGEONS, effectMetaText } = await import('./src/engine/content.js')

let passed = 0, failed = 0
const ok = (c, label) => { if (c) { passed++; console.log('  [OK] ' + label) } else { failed++; console.log('  [FAIL] ' + label) } }

newGame('QA')
const s = getState()
s.player.displayName = '爸爸'
// 全副本解锁（绕过 order 链校验，探针只关心战斗本体）
s.player.dungeonStats = Object.fromEntries(DUNGEONS.map(d => [d.id, { clears: 1 }]))
// 手工装备：效果槽带 相壁(护盾0.303) / 节律(加速0.15) / 血偿(吸血0.08) / 迟滞(减速0.2)
s.equipments.push({
  id: 'eq_probe', name: '探针甲', slot: 'armor', quality: 'epic', equipped: true,
  affixes: [], effects: [
    { templateId: 'eff_gulei', name: '古垒', slotIndex: 0, isLocked: false, trigger: 'onDamageTaken', outcome: 'shield', durationTicks: 1, cooldownTicks: 0, magnitude: 0.303, magnitudeRange: { min: 0.1, max: 0.3 }, refinedBonus: 0, chance: 1, stacking: 'none', maxStacks: 1 },
    { templateId: 'effjielu', name: '节律', slotIndex: 1, isLocked: false, trigger: 'onAttackCount', outcome: 'speedBuff', durationTicks: 12, cooldownTicks: 0, magnitude: 0.15, magnitudeRange: { min: 0.05, max: 0.18 }, refinedBonus: 0, chance: 1, stacking: 'none', maxStacks: 1 },
    { templateId: 'eff_xuechang', name: '血偿', slotIndex: 2, isLocked: false, trigger: 'onDamageTaken', outcome: 'lifesteal', durationTicks: 1, cooldownTicks: 0, magnitude: 0.08, magnitudeRange: { min: 0.03, max: 0.1 }, refinedBonus: 0, chance: 1, stacking: 'none', maxStacks: 1 },
    { templateId: 'eff_chizhi', name: '迟滞', slotIndex: 3, isLocked: false, trigger: 'onCritical', outcome: 'slow', durationTicks: 15, cooldownTicks: 0, magnitude: 0.2, magnitudeRange: { min: 0.06, max: 0.24 }, refinedBonus: 0, chance: 1, stacking: 'none', maxStacks: 1 },
  ],
  storage: false, locked: false, source: 'probe', createdAt: Date.now(),
})

const dg = DUNGEONS.find(d => d.bosses.some(b => b.name === '潮汐巨蛇'))
console.log('副本:', dg.id, dg.name)
const r = await api('/battle/start', { method: 'POST', body: { dungeonId: dg.id } })
const b = battles.get(r.battleId)
ok(!!b, '开战成功')

// 1) fx CD 全部 > 0
const cdMap = b.fx.map(f => `${f.name}:${f.outcome}:cd=${f.cooldownTicks}(${(f.cooldownTicks * 200 / 1000).toFixed(0)}s)`)
console.log('效果槽 CD:', cdMap.join(' | '))
ok(b.fx.every(f => f.cooldownTicks > 0), '所有效果槽 CD > 0（老存档 0CD 被兜底）')
const shieldFx = b.fx.find(f => f.outcome === 'shield')
ok(shieldFx && shieldFx.cooldownTicks === 150, '护盾 CD = 150 ticks（30 秒）')

// 2) 跑完整场战斗，记录每个效果触发 tick
const procTicks = {}
const shieldAdds = []
let guard = 0
while (b.status === 'running' && guard++ < 6000) {
  const pre = b.log.length
  b.step()
  for (let i = pre; i < b.log.length; i++) {
    const L = b.log[i]
    const mShield = L.text.match(/「(.+?)」触发，获得 (\d+) 点护盾/)
    if (mShield) { shieldAdds.push(+mShield[2]); (procTicks[mShield[1]] ||= []).push(b.tick) }
    const mProc = L.text.match(/的「(.+?)」触发/)
    if (mProc && !mShield) (procTicks[mProc[1]] ||= []).push(b.tick)
  }
}
console.log('战斗结束:', b.status, 'tick=', b.tick, '玩家HP=', b.player.hp, '/', b.player.maxHp)

// 3) 护盾削弱：add ≈ maxHp × mag × 0.6
if (shieldAdds.length) {
  const expect = Math.round(b.player.maxHp * shieldFx.magnitude * 0.6)
  console.log(`护盾触发 ${shieldAdds.length} 次: ${shieldAdds.join(',')} | 期望 ${expect} = ${b.player.maxHp}×${shieldFx.magnitude}×0.6`)
  ok(shieldAdds.every(a => a === expect), '护盾值 = maxHp × mag × 0.6（已削弱 40%）')
} else {
  console.log('（本场护盾未触发——Boss 阶段切换前战斗已结束或概率未中）')
}

// 4) 同效果两次触发间隔 ≥ CD
for (const [name, ticks] of Object.entries(procTicks)) {
  const fx = b.fx.find(f => f.name === name)
  if (!fx) continue
  let minGap = Infinity
  for (let i = 1; i < ticks.length; i++) minGap = Math.min(minGap, ticks[i] - ticks[i - 1])
  const label = ticks.length < 2 ? `${name} 仅触发 ${ticks.length} 次（无需校验间隔）` : `${name} 最小触发间隔 ${minGap} ≥ CD ${fx.cooldownTicks}`
  ok(ticks.length < 2 || minGap >= fx.cooldownTicks, label)
}
console.log('触发统计:', Object.entries(procTicks).map(([k, v]) => `${k}×${v.length}`).join(' ') || '无')

// 5) 描述文案
const probe = { outcome: 'shield', cooldownTicks: 0, durationTicks: 1, stacking: 'none', magnitudeRange: { max: 0.3 } }
const meta = effectMetaText(probe)
console.log('护盾效果描述（cooldownTicks=0 的老存档槽）:', meta)
ok(meta.includes('冷却 30 秒'), '描述显示冷却 30 秒而不是 0 秒')
const meta2 = effectMetaText({ outcome: 'speedBuff', cooldownTicks: 0, durationTicks: 12, stacking: 'none', magnitudeRange: { max: 0.18 } })
console.log('加速效果描述（0CD 老槽）:', meta2)
ok(meta2.includes('冷却 10 秒'), 'BUFF 描述显示冷却 10 秒')

console.log(`\n==== ${passed} passed, ${failed} failed ====`)
process.exit(failed ? 1 : 0)
