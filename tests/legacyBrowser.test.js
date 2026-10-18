import { describe, expect, it } from 'vitest'
import { legacyAsDb } from './helpers.js'
import { planLegacyImport, readLegacyExport } from '../src/lib/legacyBrowser.js'

const db = legacyAsDb()
const state = { bank: db.bank, categories: db.categories, closes: db.closes, checks: [], tpa: [] }

describe('importação dos dados do navegador antigo', () => {
  const exported = {
    localStorage: {
      despesas_app_categories_v2: JSON.stringify({ 122: 'Salários', 0: 'BBVA / financiamento', 999: 'X' }),
      faturaclaro_envelopes_v2: JSON.stringify([
        { date: '2026-01-01', shift: '7h', type: 'cv', actual: 210.68, expected: 210.68 },
        { date: '2026-01-01', shift: '7h', type: 'money', actual: 15, expected: 16 },
      ]),
      faturaclaro_cash_closes_v1: JSON.stringify([
        { date: '2026-01-01', shift: '7h', money: 16, cv: 210.68, mb: 262, cityMB: 0 },
        { date: '2026-10-01', shift: '7h', money: 1, cv: 2, mb: 3, cityMB: 0 },
        { date: '2026-07-02', shift: '23h', money: 250, cv: 1192.18, mb: 364.92, cityMB: 0 },
      ]),
      faturaclaro_tpa_v1: JSON.stringify([{ date: '2026-07-01', shift: '7h', cv: 100, mb: 50 }]),
    },
  }
  const plan = planLegacyImport(readLegacyExport(exported), state)

  it('aplica alterações de categoria pelo índice do legado', () => {
    expect(plan.categoryChanges).toHaveLength(1)
    expect(plan.categoryChanges[0]).toMatchObject({ legacy_idx: 122, para: 'Salários', de: 'Outros / por classificar' })
    expect(plan.skipped.some(s => s.includes('999'))).toBe(true)
  })
  it('converte conferências (money → dinheiro) mantendo diferenças', () => {
    expect(plan.checks).toEqual([
      { data: '2026-01-01', turno: '7h', tipo: 'cv', valor_esperado: 210.68, valor_real: 210.68 },
      { data: '2026-01-01', turno: '7h', tipo: 'dinheiro', valor_esperado: 16, valor_real: 15 },
    ])
  })
  it('deteta fechos novos e alterados no navegador', () => {
    expect(plan.closesDiff.novos.map(c => c.data)).toEqual(['2026-10-01'])
    expect(plan.closesDiff.alterados.map(c => c.depois.data)).toEqual(['2026-07-02'])
    expect(plan.closesDiff.iguais).toHaveLength(1)
  })
  it('TPA', () => expect(plan.tpa).toEqual([{ data: '2026-07-01', turno: '7h', cv: 100, mb: 50 }]))
  it('não reaplica categorias já mudadas na nova aplicação', () => {
    const changedBank = db.bank.map(t => (t.legacy_idx === 122 ? { ...t, categoria_id: db.categories.find(c => c.nome === 'Rendas').id } : t))
    const p = planLegacyImport(readLegacyExport(exported), { ...state, bank: changedBank })
    expect(p.categoryChanges).toHaveLength(0)
  })
})
