// Resumo das faturas a pagar para enviar ao fornecedor: data, nº da fatura, valor e total.
import { sum } from './money.js'
import { formatDate } from './dates.js'

const eur = v => (v == null ? 'sem valor' : `${Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)

export function supplierSummary(invoices) {
  const map = new Map()
  for (const i of invoices) {
    const nome = (i.fornecedor || '').trim() || 'Sem fornecedor'
    if (!map.has(nome)) map.set(nome, [])
    map.get(nome).push(i)
  }
  const groups = [...map].map(([nome, list]) => {
    const linhas = [...list].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id)
      .map(i => ({ id: i.id, data: i.data, documento: i.documento || '', valor: i.valor == null ? null : Number(i.valor) }))
    return { nome, linhas, total: sum(linhas.map(l => l.valor ?? 0)) }
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
  return { groups, total: sum(groups.map(g => g.total)), semValor: invoices.filter(i => i.valor == null).length }
}

// Texto simples (para o corpo do email ou para colar em qualquer sítio).
export function summaryText({ groups, total }) {
  const out = []
  for (const g of groups) {
    if (groups.length > 1) out.push(g.nome)
    out.push('Data        | Nº fatura            | Valor')
    for (const l of g.linhas) out.push(`${formatDate(l.data).padEnd(11)} | ${(l.documento || '—').padEnd(20)} | ${eur(l.valor)}`)
    out.push(`${groups.length > 1 ? `Total ${g.nome}` : 'Total'}: ${eur(g.total)}`, '')
  }
  if (groups.length > 1) out.push(`Total geral: ${eur(total)}`)
  return out.join('\n').trim()
}

// Tabela HTML (cola com formatação no Gmail/Outlook).
export function summaryHtml({ groups, total }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const td = 'style="border:1px solid #ccc;padding:4px 8px"'
  const tdr = 'style="border:1px solid #ccc;padding:4px 8px;text-align:right"'
  const parts = groups.map(g => `${groups.length > 1 ? `<p><b>${esc(g.nome)}</b></p>` : ''}<table style="border-collapse:collapse"><thead><tr><th ${td}>Data</th><th ${td}>Nº fatura</th><th ${tdr}>Valor</th></tr></thead><tbody>${
    g.linhas.map(l => `<tr><td ${td}>${esc(formatDate(l.data))}</td><td ${td}>${esc(l.documento || '—')}</td><td ${tdr}>${esc(eur(l.valor))}</td></tr>`).join('')
  }<tr><td ${td} colspan="2"><b>Total</b></td><td ${tdr}><b>${esc(eur(g.total))}</b></td></tr></tbody></table>`)
  if (groups.length > 1) parts.push(`<p><b>Total geral: ${esc(eur(total))}</b></p>`)
  return parts.join('<br>')
}
