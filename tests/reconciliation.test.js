import { describe, expect, it } from 'vitest'
import { legacyAsDb } from './helpers.js'
import { buildQueue, checkDifference, checkStatus, differencesSummary, expectedChanged, nextPendingIndex, progress, resolveActual } from '../src/lib/reconciliation.js'

const closes = [
  { id: 3, data: '2026-01-01', turno: '23h', cv: 1214.58, mb: 252, dinheiro: 0 },
  { id: 1, data: '2026-01-01', turno: '7h', cv: 210.68, mb: 262, dinheiro: 16 },
  { id: 4, data: '2026-01-02', turno: '7h', cv: 165.642, mb: 10, dinheiro: 5 },
  { id: 2, data: '2026-01-01', turno: '15h', cv: 0, mb: 226, dinheiro: 16 },
]

describe('fila da conferência', () => {
  it('segue a ordem CV → MB → Numerário → próximo envelope, por ordem cronológica 7h → 15h → 23h', () => {
    const q = buildQueue(closes, [])
    expect(q.map(i => `${i.close.data} ${i.close.turno} ${i.type}`)).toEqual([
      '2026-01-01 7h cv', '2026-01-01 7h mb', '2026-01-01 7h dinheiro',
      '2026-01-01 15h cv', '2026-01-01 15h mb', '2026-01-01 15h dinheiro',
      '2026-01-01 23h cv', '2026-01-01 23h mb', '2026-01-01 23h dinheiro',
      '2026-01-02 7h cv', '2026-01-02 7h mb', '2026-01-02 7h dinheiro',
    ])
  })
  it('o primeiro valor esperado é o CV de 01/01/2026 7h (210,68 €), como no legado', () => {
    const db = legacyAsDb()
    const q = buildQueue(db.closes, [])
    expect(q).toHaveLength(819 * 3)
    expect(q[0]).toMatchObject({ type: 'cv', expected: 210.68 })
    expect(q[0].close).toMatchObject({ data: '2026-01-01', turno: '7h' })
  })
  it('avança para o próximo item por conferir', () => {
    const checks = [{ cash_close_id: 1, tipo: 'cv', valor_esperado: 210.68, valor_real: 210.68 }]
    const q = buildQueue(closes, checks)
    expect(nextPendingIndex(q)).toBe(1)
    expect(q[nextPendingIndex(q)].type).toBe('mb')
    expect(progress(q)).toEqual({ done: 1, total: 12, pct: 8 })
  })
  it('devolve -1 quando está tudo conferido', () => {
    const checks = closes.flatMap(c => ['cv', 'mb', 'dinheiro'].map(t => ({ cash_close_id: c.id, tipo: t, valor_esperado: c[t], valor_real: c[t] })))
    expect(nextPendingIndex(buildQueue(closes, checks))).toBe(-1)
  })
})

describe('OK / Enter e valor real', () => {
  it('vazio = bate certo com o esperado', () => {
    expect(resolveActual('', 210.68)).toEqual({ ok: true, value: 210.68 })
    expect(resolveActual('   ', 165.642)).toEqual({ ok: true, value: 165.642 })
  })
  it('aceita vírgula decimal', () => {
    expect(resolveActual('200,50', 210.68)).toEqual({ ok: true, value: 200.5 })
  })
  it('rejeita valores inválidos ou negativos', () => {
    expect(resolveActual('abc', 1).ok).toBe(false)
    expect(resolveActual('-3', 1).ok).toBe(false)
  })
})

describe('diferenças e correções', () => {
  const ok = { valor_esperado: 165.642, valor_real: 165.642 }
  const bad = { valor_esperado: 16, valor_real: 14.5 }
  it('estado e diferença', () => {
    expect(checkStatus(null)).toBe('pending')
    expect(checkStatus(ok)).toBe('ok')
    expect(checkStatus(bad)).toBe('bad')
    expect(checkDifference(bad)).toBe(-1.5)
    expect(checkDifference({ valor_esperado: 10, valor_real: 12.25 })).toBe(2.25)
  })
  it('resumo de faltas e sobras', () => {
    const q = buildQueue(closes, [
      { cash_close_id: 1, tipo: 'dinheiro', valor_esperado: 16, valor_real: 14.5 },
      { cash_close_id: 2, tipo: 'dinheiro', valor_esperado: 16, valor_real: 20 },
      { cash_close_id: 1, tipo: 'cv', valor_esperado: 210.68, valor_real: 210.68 },
    ])
    expect(differencesSummary(q)).toMatchObject({ count: 2, falta: 1.5, sobra: 4 })
  })
  it('avisa quando o fecho mudou depois de conferido', () => {
    const q = buildQueue([{ ...closes[1], dinheiro: 20 }], [{ cash_close_id: 1, tipo: 'dinheiro', valor_esperado: 16, valor_real: 16 }])
    expect(expectedChanged(q.find(i => i.type === 'dinheiro'))).toBe(true)
  })
})
