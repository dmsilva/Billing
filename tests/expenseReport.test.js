import { describe, expect, it } from 'vitest'
import { expenseReport, expenseReportHtml } from '../src/lib/expenseReport.js'

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
})
