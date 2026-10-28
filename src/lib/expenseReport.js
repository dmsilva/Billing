// Relatório de despesas para imprimir ou guardar em PDF: faturas por mês, com subtotal e total.
import { sum, sumBy } from './money.js'
import { monthLabel, monthOf } from './dates.js'

const eur = v => `${Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const date = d => (d ? d.split('-').reverse().join('/') : '—')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// rows: linhas de faturas (como invoiceToRow). Rejeitadas ficam de fora; sem valor contam 0 e são assinaladas.
export function expenseReport(rows) {
  const valid = rows.filter(r => r.estado !== 'Rejeitada')
  const byMonth = new Map()
  for (const r of [...valid].sort((a, b) => String(a.data).localeCompare(String(b.data)))) {
    const k = monthOf(r.data) || 'sem-data'
    byMonth.set(k, [...(byMonth.get(k) || []), r])
  }
  const months = [...byMonth].map(([key, linhas]) => ({ key, label: key === 'sem-data' ? 'Sem data' : monthLabel(key), linhas, total: sumBy(linhas, r => r.valor) }))
  return { months, total: sum(months.map(m => m.total)), semValor: valid.filter(r => r.valor == null).length, count: valid.length }
}

export function expenseReportHtml(report, { title = 'Despesas', subtitle = '' } = {}) {
  const month = m => `
    <h2>${esc(m.label)}</h2>
    <table>
      <thead><tr><th>Data</th><th>Fornecedor</th><th>Nº fatura</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th class="n">Valor</th></tr></thead>
      <tbody>${m.linhas.map(r => `<tr><td>${date(r.data)}</td><td>${esc(r.fornecedor || '—')}</td><td>${esc(r.documento || '—')}</td><td>${esc(r.descricao)}</td><td>${esc(r.categoria)}</td><td>${esc(r.pagamento === 'Por pagar' ? 'Por liquidar' : r.pagamento)}${r.source?.liquidada_em ? ` (liquidada ${date(r.source.liquidada_em)})` : ''}</td><td class="n">${r.valor == null ? 'sem valor' : eur(r.valor)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Total de ${esc(m.label)} · ${m.linhas.length} fatura(s)</td><td class="n">${eur(m.total)}</td></tr></tfoot>
    </table>`
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font:12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:24px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:16px}
  h2{font-size:15px;margin:22px 0 6px}
  table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#f3f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  .n{text-align:right;white-space:nowrap}tfoot td{font-weight:700;border-top:2px solid #333;border-bottom:0}
  .grand{margin-top:20px;font-size:16px;font-weight:700;text-align:right}.warn{color:#a15c00}
  @media print{body{margin:12mm}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}${subtitle ? ' · ' : ''}${report.count} fatura(s)</div>
${report.semValor ? `<p class="warn">${report.semValor} fatura(s) sem valor não entram no total.</p>` : ''}
${report.months.map(month).join('')}
${report.months.length > 1 ? `<div class="grand">Total geral: ${eur(report.total)}</div>` : ''}
${report.months.length ? '' : '<p>Sem faturas.</p>'}
</body></html>`
}

// Abre o relatório numa janela nova e pede para imprimir (lá escolhe-se "Guardar como PDF").
export function printExpenseReport(rows, opts) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(expenseReportHtml(expenseReport(rows), opts))
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
  return true
}
