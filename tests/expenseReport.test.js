import { describe, expect, it } from 'vitest'
import { expenseReport, expenseReportHtml, shortDoc, simpleReport, simpleReportHtml } from '../src/lib/expenseReport.js'

const row = (o) => ({ estado: 'Validada', pagamento: 'Numerário', categoria: 'Por classificar', descricao: '', source: {}, ...o })

describe('relatório de despesas', () => {
  const rows = [
    row({ data: '2026-10-15', fornecedor: 'Pingo Doce', documento: 'FS 1', valor: 10.1 }),
    row({ data: '2026-09-30', fornecedor: 'Continente', documento: 'FT 2', valor: 0.2 }),
    row({ data: '2026-10-01', fornecedor: 'Padaria', documento: 'FS 3', valor: 5 }),
    row({ data: '2026-10-02', fornecedor: 'Rejeitada', valor: 99, estado: 'Rejeitada' }),
    row({ data: '2026-10-03', fornecedor: 'Sem valor', valor: null }),
  ]
  it('agrupa por mês, por ordem de data, com o total de cada mês e o total geral', () => {
    const r = expenseReport(rows)
    expect(r.months.map(m => [m.key, m.total, m.linhas.map(l => l.fornecedor)])).toEqual([
      ['2026-09', 0.2, ['Continente']],
      ['2026-10', 15.1, ['Padaria', 'Sem valor', 'Pingo Doce']],
    ])
    expect(r.total).toBe(15.3)
    expect(r.count).toBe(4)
    expect(r.semValor).toBe(1)
  })
  it('gera HTML com os totais e escapa o texto', () => {
    const html = expenseReportHtml(expenseReport([row({ data: '2026-10-01', fornecedor: '<b>X</b>', valor: 1234.5 })]), { title: 'Despesas' })
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(html).toMatch(/Total de .*1 fatura/)
    expect(html).toMatch(/1\s?234,50 €/)
  })
  it('simplificado: Data dd/mm, nº da fatura com link, valor e total', () => {
    const r = simpleReport([
      row({ id: 'b', data: '2026-10-14', documento: 'FT 2026/019555', valor: 306.42 }),
      row({ id: 'a', data: '2026-10-07', documento: 'FT 2026/019144', valor: 473.97 }),
      row({ id: 'x', data: '2026-10-08', documento: 'FT 2026/1', valor: 50, estado: 'Rejeitada' }),
    ])
    expect(r.linhas.map(l => l.id)).toEqual(['a', 'b'])
    expect(r.total).toBe(780.39)
    const html = simpleReportHtml(r, { title: 'Grão de Trigo', links: { a: 'https://x.supabase.co/f?token=1&b=2', b: 'javascript:alert(1)' } })
    expect(html).toContain('<td>07/10</td>')
    expect(html).toContain('<a href="https://x.supabase.co/f?token=1&amp;b=2" target="_blank" rel="noreferrer">019144</a>')
    expect(html).not.toContain('javascript:')
    expect(html).toMatch(/Total<\/td><td class="n">780,39 €/)
  })
  it('número curto da fatura', () => {
    expect(shortDoc('FT 2026/019144')).toBe('019144')
    expect(shortDoc('FS 12')).toBe('12')
    expect(shortDoc('019144')).toBe('019144')
    expect(shortDoc(null)).toBe('')
  })
})
