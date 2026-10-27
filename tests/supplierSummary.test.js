import { describe, expect, it } from 'vitest'
import { summaryHtml, summaryText, supplierSummary } from '../src/lib/supplierSummary.js'

const inv = [
  { id: 2, fornecedor: 'STI', data: '2026-10-05', documento: 'FT 2026/88', valor: 120.1 },
  { id: 1, fornecedor: 'STI', data: '2026-10-01', documento: 'FT 2026/80', valor: 30.2 },
]

describe('resumo para o fornecedor', () => {
  it('ordena por data e soma o total', () => {
    const s = supplierSummary(inv)
    expect(s.groups[0].linhas.map(l => l.documento)).toEqual(['FT 2026/80', 'FT 2026/88'])
    expect(s.total).toBe(150.3)
  })
  it('texto com data, nº e valor e o total em baixo', () => {
    const t = summaryText(supplierSummary(inv))
    expect(t).toContain('01/10/2026')
    expect(t).toContain('FT 2026/88')
    expect(t.split('\n').at(-1)).toMatch(/^Total: 150,30 €$/)
  })
  it('vários fornecedores têm subtotais e total geral; HTML escapa o texto', () => {
    const s = supplierSummary([...inv, { id: 3, fornecedor: 'Lidl <x>', data: '2026-10-02', documento: 'A', valor: 10 }])
    expect(s.groups).toHaveLength(2)
    expect(summaryText(s)).toContain('Total geral: 160,30 €')
    expect(summaryHtml(s)).toContain('Lidl &lt;x&gt;')
  })
})
