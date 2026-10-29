import { describe, expect, it } from 'vitest'
import { byArtigo, invoicesToRead, lineArtigo, linesInPeriod, normalizeUnit, periodPresets, totalOf } from '../src/lib/artigos.js'

const invoices = [
  { id: 1, data: '2026-10-05', estado: 'Validada', invoice_files: [{ id: 1 }] },
  { id: 2, data: '2026-09-12', estado: 'Por validar', invoice_files: [{ id: 2 }] },
  { id: 3, data: '2026-10-07', estado: 'Rejeitada', invoice_files: [{ id: 3 }] },
  { id: 4, data: '2026-10-08', estado: 'Validada', invoice_files: [{ id: 4 }] },
  { id: 5, data: '2026-10-09', estado: 'Validada', invoice_files: [{ id: 5 }], artigos_lidos_em: '2026-10-10T10:00:00Z' },
  { id: 6, data: '2026-10-09', estado: 'Validada', invoice_files: [] },
]
const byId = new Map(invoices.map(i => [i.id, i]))
const lines = [
  { id: 1, invoice_id: 1, produto: 'MANTEIGA MIMOSA 250G', artigo: 'Manteiga', tipo: 'Laticínios', quantidade: 4, unidade: 'un', valor: 9.56, fornecedor: 'Makro' },
  { id: 2, invoice_id: 2, produto: 'Manteiga Président', artigo: 'manteiga', tipo: 'Laticínios', quantidade: 2, unidade: 'UN', valor: 5.1, fornecedor: 'Pingo Doce' },
  { id: 3, invoice_id: 1, produto: 'Leite meio gordo', artigo: 'Leite', tipo: 'Laticínios', quantidade: 12, unidade: 'lt', valor: 9.48, fornecedor: 'Makro' },
  { id: 4, invoice_id: 3, produto: 'Manteiga', artigo: 'Manteiga', tipo: 'Laticínios', quantidade: 1, unidade: 'un', valor: 100 },
  { id: 5, legacy_idx: 1, produto: 'Detergente loiça', tipo: 'Limpeza', quantidade: null, valor: null },
  { id: 6, invoice_id: null, data: '2026-10-15', produto: 'Lixívia', artigo: 'Lixívia', tipo: 'Limpeza', quantidade: 1, unidade: 'kg', valor: 1.2 },
]

describe('gasto por artigo', () => {
  it('filtra o período e deixa de fora faturas rejeitadas', () => {
    expect(linesInPeriod(lines, byId, { de: '2026-10-01', ate: '2026-10-31' }).map(l => l.id)).toEqual([1, 3, 6])
    expect(linesInPeriod(lines, byId, { de: '2026-07-01', ate: '2026-07-31' }).map(l => l.id)).toEqual([5])
    expect(linesInPeriod(lines, byId, {}).map(l => l.id)).toEqual([1, 2, 3, 5, 6])
  })
  it('soma o mesmo artigo de marcas e fornecedores diferentes', () => {
    const g = byArtigo(linesInPeriod(lines, byId, {}))
    expect(g[0]).toMatchObject({ artigo: 'Manteiga', tipo: 'Laticínios', total: 14.66, compras: 2, quantidades: [{ unidade: 'un', quantidade: 6 }], fornecedores: ['Makro', 'Pingo Doce'] })
    expect(g[1]).toMatchObject({ artigo: 'Leite', total: 9.48, quantidades: [{ unidade: 'L', quantidade: 12 }] })
    expect(g.find(x => x.artigo === 'Detergente loiça')).toMatchObject({ total: 0, semValor: 1 })
    expect(totalOf(lines.slice(0, 3))).toBe(24.14)
  })
  it('usa o nome do produto quando a linha não tem artigo', () => {
    expect(lineArtigo({ produto: ' Pão ' })).toBe('Pão')
    expect(lineArtigo({})).toBe('Sem nome')
    expect(normalizeUnit('Unid.')).toBe('un')
    expect(normalizeUnit('')).toBe('un')
  })
  it('lista as faturas com ficheiros ainda por ler', () => {
    expect(invoicesToRead(invoices, lines).map(i => i.id)).toEqual([4])
  })
  it('calcula os períodos rápidos', () => {
    const p = Object.fromEntries(periodPresets('2026-01-15').map(x => [x.key, [x.de, x.ate]]))
    expect(p.mes).toEqual(['2026-01-01', '2026-01-31'])
    expect(p['mes-passado']).toEqual(['2025-12-01', '2025-12-31'])
    expect(p['3-meses']).toEqual(['2025-11-01', '2026-01-31'])
    expect(p.ano).toEqual(['2026-01-01', '2026-12-31'])
    expect(p.tudo).toEqual(['', ''])
  })
})
