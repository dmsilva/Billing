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

// Versão simplificada (ex.: lista para pagar a um fornecedor): só Data (dd/mm), Fatura (nº, com link
// para o ficheiro quando há) e Valor, por ordem de data, com uma linha de Total no fim.
// links: { [idDaFatura]: url } com links assinados para o ficheiro de cada fatura.
export function simpleReport(rows) {
  const linhas = rows.filter(r => r.estado !== 'Rejeitada').sort((a, b) => String(a.data).localeCompare(String(b.data)))
  return { linhas, total: sumBy(linhas, r => r.valor), semValor: linhas.filter(r => r.valor == null).length }
}

// "FT 2026/019144" → "019144" (como na fatura que o fornecedor mostra); sem "/" fica tal e qual.
export const shortDoc = d => { const s = String(d ?? '').trim(); return s.split(/[/\s]/).filter(Boolean).pop() || '' }
// Como no exemplo do Daniel: "1 690,66 €" (o pt-PT normal não separa milhares com 4 dígitos).
const eurG = v => `${Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`
const ddmm = d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—')
const safeUrl = u => (/^https:\/\//.test(String(u || '')) ? u : '')

export function simpleReportHtml(report, { title = 'Despesas', subtitle = '', links = {} } = {}) {
  const doc = r => {
    const n = esc(shortDoc(r.documento) || '—')
    const u = safeUrl(links[r.id])
    return u ? `<a href="${esc(u)}" target="_blank" rel="noreferrer">${n}</a>` : n
  }
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#222;margin:24px}
  h1{font-size:18px;margin:0 0 2px}.sub{color:#777;margin-bottom:14px;font-size:12px}
  table{border-collapse:collapse;min-width:300px}
  th,td{border-bottom:1px solid #e6e6e6;padding:12px 14px;text-align:left}
  th{color:#8a7a80;font-weight:600}
  td.n,th.n{text-align:right;white-space:nowrap}td.n{font-weight:700}
  a{color:#b0587a}
  tfoot td{font-weight:700;border-top:1px solid #ccc;border-bottom:0}
  .warn{color:#a15c00;font-size:12px}
  @media print{body{margin:12mm}tr{break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
${report.semValor ? `<p class="warn">${report.semValor} fatura(s) sem valor não entram no total.</p>` : ''}
${report.linhas.length ? `<table>
  <thead><tr><th>Data</th><th>Fatura</th><th class="n">Valor</th></tr></thead>
  <tbody>${report.linhas.map(r => `<tr><td>${ddmm(r.data)}</td><td>${doc(r)}</td><td class="n">${r.valor == null ? 'sem valor' : eurG(r.valor)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td colspan="2">Total</td><td class="n">${eurG(report.total)}</td></tr></tfoot>
</table>` : '<p>Sem faturas.</p>'}
</body></html>`
}

// Abre a janela logo (no clique, para o navegador não a bloquear) e só depois preenche,
// porque os links dos ficheiros são pedidos ao Supabase.
export async function printSimpleReport(rows, { getLinks, ...opts } = {}) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write('<p style="font-family:sans-serif;margin:24px">A preparar o PDF…</p>')
  const report = simpleReport(rows)
  let links = {}
  try { links = getLinks ? await getLinks(report.linhas) : {} } catch { links = {} }
  w.document.open()
  w.document.write(simpleReportHtml(report, { ...opts, links }))
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
  return true
}
