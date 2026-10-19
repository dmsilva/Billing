import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { legacy } from './helpers.js'
import { buildSeedSql } from '../scripts/lib/seed.mjs'
import expected from '../src/data/legacyExpected.json'

const root = join(import.meta.dirname, '..')

describe('migração dos dados reais', () => {
  it('o HTML legado tem todos os registos esperados', () => {
    expect(legacy.transactions).toHaveLength(143)
    expect(legacy.cashInvoices).toHaveLength(13)
    expect(legacy.items).toHaveLength(59)
    expect(legacy.cashCloses).toHaveLength(819)
  })
  it('totais de referência', () => {
    expect(expected).toMatchObject({
      bank: { count: 143, total: 124736.02 },
      bankCompanyTransfers: { count: 2, total: 5150 },
      cashInvoices: { count: 13, total: 1354.49 },
      items: { count: 59, total: 1610.24, withoutValue: 1 },
      cashCloses: { count: 819, dinheiro: 32525.47, cv: 440347.392, mb: 225332.324, cityMb: 2553.8, total: 700758.986, firstDate: '2026-01-01', lastDate: '2026-09-30' },
    })
  })
  it('o 03_seed_legacy.sql está atualizado (gerado a partir do HTML)', () => {
    const { sql } = buildSeedSql(legacy)
    expect(readFileSync(join(root, 'supabase', '03_seed_legacy.sql'), 'utf-8')).toBe(sql)
  })
  it('o SQL contém um registo por cada linha legada', () => {
    const sql = readFileSync(join(root, 'supabase', '03_seed_legacy.sql'), 'utf-8')
    const section = (from, to) => sql.slice(sql.indexOf(from), sql.indexOf(to, sql.indexOf(from)))
    const count = s => (s.match(/^\s{2}\(/gm) || []).length
    expect(count(section('insert into public.bank_transactions', 'on conflict'))).toBe(143)
    expect(count(section('insert into public.invoices', 'on conflict'))).toBe(13)
    expect(count(section('insert into public.invoice_lines', 'on conflict'))).toBe(59)
    expect(count(section('insert into public.cash_closes', 'on conflict'))).toBe(819)
  })
  it('valores com 3 casas decimais são preservados sem arredondar', () => {
    const sql = readFileSync(join(root, 'supabase', '03_seed_legacy.sql'), 'utf-8')
    expect(sql).toContain("('2026-01-03', '7h', 5, 165.642,")
    expect(sql).toMatch(/\('2026-02-05', '23h', [\d.]+, [\d.]+, 162\.394,/)
  })
  it('nenhuma credencial no código', () => {
    const files = ['src/supabase.js', 'netlify.toml', '.env.example']
    for (const f of files) {
      const t = readFileSync(join(root, f), 'utf-8')
      expect(t).not.toMatch(/service_role\s*[:=]\s*['"]?ey/i)
      expect(t).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/)
    }
  })
})
