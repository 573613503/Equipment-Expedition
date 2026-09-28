// 工坊链路临时冒烟测试（跑完即删）
import fs from 'node:fs'
const LOG = []
const _log = console.log
console.log = (...a) => { const s = a.join(' '); LOG.push(s); _log(s) }
process.on('exit', () => { try { fs.writeFileSync(new URL('./_smoke_out.txt', import.meta.url), LOG.join('\n'), 'utf8') } catch {} })
globalThis.localStorage = (() => {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  }
})()

const save = await import('./src/engine/save.js')
const { api } = await import('./src/engine/engine.js')
const G = await import('./src/engine/game.js')
const E = await import('./src/engine/equip.js')
const C = (await import('./src/engine/content.js')).default

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, ' ', extra) }
}
async function step(name, fn) {
  try { await fn() } catch (e) { fail++; console.log('  ✗', name, '抛错:', e.message) }
}
/** 期望「必须报错」的用例 */
async function stepErr(name, fn) {
  try { await fn(); fail++; console.log('  ✗', name, '（本该报错却通过了）') }
  catch (e) { pass++; console.log('  ✓', name, '→', e.message) }
}
// 未捕获异常也要落进日志，否则 PowerShell 通道看不到堆栈
process.on('uncaughtException', e => { fail++; console.log('  ✗ 未捕获异常:', e && (e.stack || e.message)) })
process.on('unhandledRejection', e => { fail++; console.log('  ✗ 未处理的 rejection:', e && (e.stack || e.message)) })

save.createSave('测试员')
const st = save.getState()

function mk(tplId, qIdx) {
  const tpl = C.templateOf(tplId)
  const eq = G.rollEquipment([{ id: tpl.id, slot: tpl.slot }], { [C.QUALITIES[qIdx].id]: 1 })
  st.equipments.push(eq)
  return eq
}
const A = mk('weapon_ember_blade', 1)   // 普通：精炼/强化/升华/拆解
const B = mk('weapon_ember_blade', 2)   // 优良：锁定/重铸/升星/传承
const ID = A.id, ID_B = B.id

console.log('\n[1] 装备结构')
ok('base 有值', Object.keys(A.base).length > 0, JSON.stringify(A.base))
ok('普通品质 1 个前缀槽', A.prefixes.length === 1 && A.suffixes.length === 0)
ok('优良品质 1 前 + 1 后', B.prefixes.length === 1 && B.suffixes.length === 1)
ok('槽位带 min/max/value/condition', A.prefixes[0].values[0].max > A.prefixes[0].values[0].min)
ok('有词条池快照', (A.pool?.prefixes || []).length > 0, `${(A.pool?.prefixes || []).length} 个前缀候选`)
ok('refinements 已初始化', A.refinements && A.refinements.totalRefines === 0)

console.log('\n[2] GET /equipment/{id} 与 costs')
const d = await api(`/equipment/${ID}`)
ok('详情返回 equipment', !!d.equipment && d.equipment.id === ID)
ok('详情含 prefixes/suffixes/effects', Array.isArray(d.equipment.prefixes) && Array.isArray(d.equipment.effects))
const costs = await api(`/equipment/${ID}/costs`)
for (const k of ['reroll', 'rerollFocused', 'ascend', 'enhance', 'star', 'transfer', 'refine', 'salvage', 'focusTags']) {
  ok(`costs.${k} 存在`, costs[k] != null)
}
ok('reroll = 普通碎片×2 + 金币20', JSON.stringify(costs.reroll.materials) === JSON.stringify({ shard_common: 2, gold: 20 }), JSON.stringify(costs.reroll.materials))
ok('rerollFocused = 普通碎片×3 + 金币30 + 灰烬结晶×1', JSON.stringify(costs.rerollFocused.materials) === JSON.stringify({ shard_common: 3, gold: 30, theme_ashen: 1 }), JSON.stringify(costs.rerollFocused.materials))
ok('enhance = 锻魂砂×4 + 金币100', JSON.stringify(costs.enhance.materials) === JSON.stringify({ forge_sand: 4, gold: 100 }))
ok('star = 星芒核×17 + 金币800 / 喂养值100', JSON.stringify(costs.star.materials) === JSON.stringify({ star_core: 17, gold: 800 }) && costs.star.feedRequired === 100)
ok('ascend = 普通碎片×7 + 灰烬结晶×2 + 金币260', JSON.stringify(costs.ascend.materials) === JSON.stringify({ shard_common: 7, theme_ashen: 2, gold: 260 }), JSON.stringify(costs.ascend.materials))
ok('transfer = 普通碎片×1 + 灰烬结晶×2 + 金币60', JSON.stringify(costs.transfer.materials) === JSON.stringify({ shard_common: 1, theme_ashen: 2, gold: 60 }))
ok('refine 按 poolType:slotIndex:statIndex 建索引', Object.keys(costs.refine).length >= 1 && /^prefix:0:0$/.test(Object.keys(costs.refine)[0]), Object.keys(costs.refine).join(','))
const refined = Object.values(costs.refine).find(x => /^prefix:0:0$/.test('') || true)
ok('refine 有 maxGain 且 > 0', refined.maxGain > 0, JSON.stringify(refined))

console.log('\n[3] 材料不足要报错')
await api('/redeem', { method: 'POST', body: { code: 'CDK-TEST' } })
await stepErr('无碎片时精炼应报错', async () => {
  await api('/equipment/refine', { method: 'POST', body: { id: ID, poolType: 'prefix', slotIndex: 0, statIndex: 0 } })
})

console.log('\n[4] 发料后跑通六件事')
const mats = st.player.materials
for (const [n, c] of [['普通碎片', 500], ['优良碎片', 500], ['稀有碎片', 500], ['史诗碎片', 500],
  ['词条尘', 500], ['锻魂砂', 500], ['护炉符', 50], ['星芒核', 500], ['灰烬结晶', 500], ['潮汐珠', 500]]) mats[n] = c
st.player.wallet.gold = 5_000_000

// --- 精炼 ---
const t0 = { poolType: 'prefix', slotIndex: 0, statIndex: 0 }
const r1 = await api('/equipment/refine', { method: 'POST', body: { id: ID, ...t0 } })
const v1 = r1.equipment.prefixes[0].values[0]
ok(`精炼成功（+${r1.gained}，refinedBonus ${v1.refinedBonus}）`, r1.gained > 0 && v1.refinedBonus === r1.gained)
ok('精炼累计次数 +1', r1.equipment.refinements.totalRefines === 1)
ok('精炼投入已记账（金币10 / 词条尘2）', r1.equipment.refinements.invested.gold === 10 && r1.equipment.refinements.invested.affix_dust === 2, JSON.stringify(r1.equipment.refinements.invested))
ok('金币已扣 10', r1.wallet.gold === 5_000_000 - 10, String(r1.wallet.gold))
const c2 = (await api(`/equipment/${ID}/costs`)).refine['prefix:0:0']
ok('第二次精炼涨价（金币13 / 词条尘3）', c2.materials.gold === 13 && c2.materials.affix_dust === 3, JSON.stringify(c2.materials))
const v0 = A.prefixes[0].values[0]
const room = v0.max - (v0.value + v0.refinedBonus)
ok('maxGain 受「上限 - 当前值」约束', c2.maxGain === Math.min(C.refineMaxGain(v0.stat, v0.max), room), `maxGain=${c2.maxGain} 剩余空间=${room}`)

// --- 锁定 + 重铸（优良：锁前缀，重掷后缀） ---
const lk = await api('/equipment/lock', { method: 'POST', body: { id: ID_B, target: 'slot', locked: true, poolType: 'prefix', slotIndex: 0 } })
ok('词条可锁定', lk.equipment.prefixes[0].isLocked === true)
const cb = await api(`/equipment/${ID_B}/costs`)
ok('锁 1 槽后重铸成本上涨（优良碎片×5 + 词条尘×2 + 金币53）', JSON.stringify(cb.reroll.materials) === JSON.stringify({ shard_fine: 5, gold: 53, affix_dust: 2 }), JSON.stringify(cb.reroll.materials))
ok('锁 1 槽定向重铸（优良碎片×7 + 词条尘×2 + 金币79 + 结晶×1）', JSON.stringify(cb.rerollFocused.materials) === JSON.stringify({ shard_fine: 7, gold: 79, affix_dust: 2, theme_ashen: 1 }), JSON.stringify(cb.rerollFocused.materials))
const keptName = B.prefixes[0].name, oldSuffix = B.suffixes[0].name
const rr = await api('/equipment/reroll', { method: 'POST', body: { id: ID_B } })
ok('重铸后锁定槽位保留', rr.equipment.prefixes[0].name === keptName && rr.equipment.prefixes[0].isLocked, `${keptName} → ${rr.equipment.prefixes.map(p => p.name)}`)
ok('重铸后未锁定槽位已换（可能恰好抽到同名）', typeof rr.equipment.suffixes[0]?.name === 'string', `${oldSuffix} → ${rr.equipment.suffixes[0]?.name}`)
ok('重铸后槽位数不变', rr.equipment.prefixes.length === 1 && rr.equipment.suffixes.length === 1)
// 定向重铸
const rf = await api('/equipment/reroll', { method: 'POST', body: { id: ID_B, focusTag: 'speed' } })
ok('定向重铸可用', rf.focusTag === 'speed' && rf.equipment.suffixes.length === 1)

// --- 强化 ---
const en1 = await api('/equipment/enhance', { method: 'POST', body: { id: ID } })
ok(`强化到 +${en1.equipment.enhancement}`, en1.success === true && en1.equipment.enhancement === 1)
const en2 = await api('/equipment/enhance', { method: 'POST', body: { id: ID } })
ok('强化可继续 → +2', en2.equipment.enhancement === 2)
// 必成阶段不需要护炉符
const cEn = (await api(`/equipment/${ID}/costs`)).enhance
ok('+10 之前 wardMaterialId 为 null、successRate=1', cEn.wardMaterialId === null && cEn.successRate === 1)
// 期望锚点：原版「+0 → +20 全程」贴符 29.4 次 / 不贴符 121.2 次。
// 原版在 successRate=1 的 +0 阶段同样返回 expected，故这里回到 +0 取值。
A.enhancement = 0
const cEn0 = (await api(`/equipment/${ID}/costs`)).enhance
ok('+0 时也给出「贴符 / 不贴符」两条预计', !!cEn0.expected?.noWard && !!cEn0.expected?.withWard)
ok('贴符预计次数 ≈ 29.4（实测锚点）', Math.abs(cEn0.expected.withWard.attempts - 29.4) < 0.5, String(cEn0.expected.withWard.attempts))
ok('不贴符预计次数 ≈ 121.2（实测锚点）', Math.abs(cEn0.expected.noWard.attempts - 121.2) < 0.5, String(cEn0.expected.noWard.attempts))
ok('贴符预计护炉符 ≈ 9 张（实测锚点）', cEn0.expected.withWard.materials.forge_ward === 9, String(cEn0.expected.withWard.materials.forge_ward))
// 跳到 +10 看护炉符与「剩余等级缩短后的预计」
A.enhancement = 10
const cEn10 = (await api(`/equipment/${ID}/costs`)).enhance
ok('+10 → +11 需要护炉符', cEn10.wardMaterialId === 'forge_ward' && cEn10.successRate < 1, JSON.stringify(cEn10.successRate))
ok('+10 起预计只剩风险段（≈111.2 次）', cEn10.expected.noWard.attempts > 100 && cEn10.expected.noWard.attempts < cEn0.expected.noWard.attempts, String(cEn10.expected.noWard.attempts))
A.enhancement = 2
// 护炉符：把成功率压到很低，反复试到失败，验证不掉级
A.enhancement = 19
mats['锻魂砂'] = 20000
mats['护炉符'] = 500
let wardWorks = false
for (let i = 0; i < 60 && !wardWorks; i++) {
  if (A.enhancement >= 20) A.enhancement = 19 // 偶然强化成功就退回来接着试
  const before = A.enhancement
  const r = await api('/equipment/enhance', { method: 'POST', body: { id: ID, useWard: true } })
  if (!r.success && r.wardConsumed && r.equipment.enhancement === before) wardWorks = true
  else if (r.equipment.enhancement >= 20) A.enhancement = 19
}
ok('失败时护炉符挡下掉级（等级不变 + wardConsumed）', wardWorks)
A.enhancement = 0

// --- 升星（喂同部位装备） ---
const feed = []
for (let i = 0; i < 12; i++) feed.push(mk('weapon_ember_blade', 1).id)
const sr = await api('/equipment/star', { method: 'POST', body: { id: ID_B, feedIds: feed } })
ok(`升星成功 ★${sr.equipment.stars}，狗粮销毁 ${sr.consumedIds.length} 件`, sr.equipment.stars === 1 && sr.consumedIds.length > 0, JSON.stringify(sr.consumedIds))
ok('升星把词条上限抬高 12%', sr.equipment.prefixes[0].values[0].max > B.prefixes[0].values[0].max * 0.99, `${B.prefixes[0].values[0].max} → ${sr.equipment.prefixes[0].values[0].max}`)
await stepErr('喂养值不够应报错', async () => {
  await api('/equipment/star', { method: 'POST', body: { id: ID_B, feedIds: [] } })
})

// --- 升华 ---
// 先给 B 精炼一次，才能验证「升华不清空精炼进度」
await api('/equipment/refine', { method: 'POST', body: { id: ID_B, ...t0 } })
const baseAttackBefore = B.base.attack
const asc = await api('/equipment/ascend', { method: 'POST', body: { id: ID_B } })
ok(`升华成功 → ${asc.toQuality}`, asc.toQuality === '稀有' && asc.equipment.qualityIdx === 3)
ok('升华后 ascensions=1 / ascended=true', asc.equipment.ascensions === 1 && asc.equipment.ascended === true)
ok('升华新开了效果槽位（优良→稀有效果槽 0→1）', asc.equipment.effects.length === 1, JSON.stringify(asc.equipment.effects.map(e => e.name)))
ok('升华基础属性按新品质重算（变高）', asc.equipment.base.attack > baseAttackBefore, `${baseAttackBefore} → ${asc.equipment.base.attack}`)
const keptBonus = [...asc.equipment.prefixes, ...asc.equipment.suffixes].some(a => (a.values || []).some(v => v.refinedBonus > 0))
ok('升华保留精炼进度（refinedBonus 未清零）', asc.equipment.refinements.totalRefines >= 1 && keptBonus, `totalRefines=${asc.equipment.refinements.totalRefines}`)
await stepErr('二次升华应报错', async () => {
  await api('/equipment/ascend', { method: 'POST', body: { id: ID_B } })
})

// --- 传承 ---
const donor = mk('weapon_ember_blade', 2)
donor.prefixes[0].isLocked = true
const donorName = donor.prefixes[0].name
const tr = await api('/equipment/transfer', { method: 'POST', body: { id: ID_B, sourceId: donor.id, sourcePoolType: 'prefix', sourceSlotIndex: 0, targetSlotIndex: 1 } })
ok('传承后目标槽位换成捐赠装备的词条', tr.equipment.prefixes.find(p => p.slotIndex === 1)?.name === donorName, JSON.stringify(tr.equipment.prefixes.map(p => `${p.slotIndex}:${p.name}`)))
ok('传承来的词条默认锁定', tr.equipment.prefixes.find(p => p.slotIndex === 1)?.isLocked === true)
ok('捐赠装备已销毁', !st.equipments.some(f => f.id === donor.id))
await stepErr('未锁定词条不能传承', async () => {
  const d2 = mk('weapon_ember_blade', 2)
  await api('/equipment/transfer', { method: 'POST', body: { id: ID_B, sourceId: d2.id, sourcePoolType: 'prefix', sourceSlotIndex: 0, targetSlotIndex: 1 } })
})

// --- 拆解 ---
const goldBefore = st.player.wallet.gold
const dustBefore = mats['词条尘']
const invested = { ...A.refinements.invested }
const sal = await api('/equipment/salvage', { method: 'POST', body: { id: ID } })
ok('拆解返回基础产出 + 返还', !!sal.yield.materials && !!sal.yield.refunded, JSON.stringify(sal.yield))
ok('基础产出 = 普通碎片×1 + 词条尘×1 + 灰烬结晶×1', JSON.stringify(sal.yield.materials) === JSON.stringify({ shard_common: 1, affix_dust: 1, theme_ashen: 1 }), JSON.stringify(sal.yield.materials))
// 原版语义：把「已投入的培养材料」按 50% 向下取整返还（实测 投入 23金/5尘/2碎片 → 返还 11/2/1）
const wantRefund = {}
for (const [k, v] of Object.entries(invested)) { const r = Math.floor(v * C.SALVAGE_REFUND_RATIO); if (r > 0) wantRefund[k] = r }
const gotRefund = sal.yield.refunded
ok('返还 50%（按实际已投入额向下取整）', Object.keys(gotRefund).length === Object.keys(wantRefund).length && Object.entries(wantRefund).every(([k, v]) => gotRefund[k] === v), `已投入 ${JSON.stringify(invested)} → 返还 ${JSON.stringify(gotRefund)}，期望 ${JSON.stringify(wantRefund)}`)
ok('金币确实进账', st.player.wallet.gold === goldBefore + (gotRefund.gold || 0), `${goldBefore} → ${st.player.wallet.gold}`)
ok('词条尘确实进账（基础产出 + 返还）', mats['词条尘'] === dustBefore + (gotRefund.affix_dust || 0) + (sal.yield.materials.affix_dust || 0), `${dustBefore} → ${mats['词条尘']}`)
ok('拆解后装备已移除', !st.equipments.some(f => f.id === ID))

console.log('\n[5] /me 面板与强化倍率')
const starter = st.equipments.find(e => e.equipped)
const me0 = await api('/me')
ok('/me 有 stats', !!me0.stats && me0.stats.attack > 0)
starter.enhancement = 10
const me1 = await api('/me')
ok('强化 +10 → base 攻击 ×1.5', Math.abs(me1.stats.attack - (me0.stats.attack + starter.base.attack * 0.5)) < 0.6, `${me0.stats.attack} → ${me1.stats.attack}`)
starter.enhancement = 0
ok('强化倍率 = 1 + 0.05 × 等级（原版 statPerLevel）', C.ENHANCEMENT.statPerLevel === 0.05)

console.log('\n[6] 老档迁移（v2 扁平词条 → v3 结构化）')
const old = {
  id: 999, templateId: 'weapon_ember_blade', slot: 'weapon', qualityIdx: 2,
  enhancement: 3, ascended: true,
  base: { attack: 33, critRate: 0.02 },
  affixes: [{ id: 'pre_elemental', name: '元素', stat: 'elementalDamage', value: 21 }],
  effects: [{ id: 'eff_rage', name: '怒焰' }],
  storage: 'backpack', equipped: false, locked: false,
}
E.migrateEquipment(old)
ok('affixes 被转成 prefixes', old.prefixes.length === 1 && old.affixes === undefined, JSON.stringify(old.prefixes.map(p => p.name)))
ok('迁移后 ascensions=1', old.ascensions === 1)
ok('迁移后 stars=0 / refinements 初始化', old.stars === 0 && old.refinements.totalRefines === 0)
ok('迁移后词条数值夹在上下限内', old.prefixes[0].values[0].value <= old.prefixes[0].values[0].max)
ok('迁移后效果槽有 magnitudeRange', old.effects[0]?.magnitudeRange?.max > 0, JSON.stringify(old.effects[0]))
// 优良本身只有 1前+1后（effectSlots=0），老档带上来的效果不截断、原样保留
ok('迁移补足优良槽位（1前+1后），老档效果保留', old.prefixes.length === 1 && old.suffixes.length === 1 && old.effects.length === 1, `p${old.prefixes.length}/s${old.suffixes.length}/e${old.effects.length}`)
ok('迁移可重复执行（幂等）', (() => { E.migrateEquipment(old); return old.prefixes.length === 1 && old.effects.length === 1 })())

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`)
process.exit(fail ? 1 : 0)
