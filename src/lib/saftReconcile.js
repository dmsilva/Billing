// Cruzamento do SAF-T (o que foi faturado) com a caixa diária e as entradas no banco.
//
// Regras (iguais às dos Resultados, para não contar o mesmo dinheiro duas vezes):
//  - Caixa do dia = dinheiro + CV + MB + City MB.
//  - "TPA / Multibanco" no banco é o MB e o CV da caixa a chegar à conta: serve para conferir
//    a caixa, nunca soma outra vez ao recebido.
//  - Recebido fora da caixa = entradas no banco que contam como receita (Expedia, Stripe,
//    transferências…), como em creditCountsAsRevenue.
import { docCounts, docSign, needsReceipt } from './saft.js'
import { cashCloseTotal, creditCountsAsRevenue } from './finance.js'
import { sameAmount, sub, sum, sumBy } from './money.js'
import { monthOf } from './dates.js'

const TPA = 'TPA / Multibanco'
// Uma diferença pequena entre a caixa e o TPA (arredondamentos, um pagamento que entra no dia
// seguinte) não é alarme.
const TPA_TOLERANCE = 50

export const signedTotal = d => docSign(d) * Number(d.total || 0)
export const signedCityTax = d => docSign(d) * Number(d.city_tax || 0)

export const saftMonths = docs => [...new Set(docs.map(d => monthOf(d.data)))].filter(Boolean).sort()

// Faturado SAF-T por mês: { 'AAAA-MM': { total, cityTax } } (sem documentos anulados).
export function saftByMonth(docs) {
  const out = {}
  for (const d of docs.filter(docCounts)) {
    const m = monthOf(d.data)
    out[m] ||= { total: 0, cityTax: 0 }
    out[m].total = sum([out[m].total, signedTotal(d)])
    out[m].cityTax = sum([out[m].cityTax, signedCityTax(d)])
  }
  return out
}

function daysOfMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

// Saltos na numeração de cada série (ex.: FT A/10, FT A/12 → falta FT A/11).
export function numberingGaps(docs) {
  const series = new Map()
  for (const d of docs) {
    const m = /^(.*\/)(\d+)$/.exec(d.numero || '')
    if (!m) continue
    if (!series.has(m[1])) series.set(m[1], [])
    series.get(m[1]).push(Number(m[2]))
  }
  const gaps = []
  for (const [serie, nums] of series) {
    const set = new Set(nums)
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    for (let n = min + 1; n < max; n++) if (!set.has(n)) gaps.push(`${serie}${n}`)
  }
  return gaps
}

// Anuladas sem outra fatura válida para o mesmo cliente nesse mês (para "Consumidor Final",
// nesse mesmo dia e com valor parecido não dá para saber: fica sempre na lista).
function annulledWithoutReplacement(docs) {
  const validos = docs.filter(d => docCounts(d) && d.tipo !== 'NC')
  return docs.filter(d => d.estado === 'A').filter(a => {
    const nome = (a.cliente || '').trim().toLowerCase()
    if (!nome || nome === 'consumidor final') return true
    return !validos.some(v => (v.cliente || '').trim().toLowerCase() === nome)
  })
}

export function saftReconcile(month, { docs, closes, credits }) {
  const doMes = docs.filter(d => monthOf(d.data) === month)
  const validos = doMes.filter(docCounts)
  const closesMes = closes.filter(c => monthOf(c.data) === month)
  const creditsMes = credits.filter(c => monthOf(c.data_mov) === month)

  // Sem nenhum TPA no mês o extrato ainda não foi importado: não há com que conferir.
  const temTpa = creditsMes.some(c => c.tipo === TPA)
  const dias = daysOfMonth(month).map(dia => {
    const docsDia = validos.filter(d => d.data === dia)
    const cx = closesMes.filter(c => c.data === dia)
    const tpa = sumBy(creditsMes.filter(c => c.data_mov === dia && c.tipo === TPA), c => c.valor)
    const caixa = sum(cx.map(cashCloseTotal))
    const cartoes = sumBy(cx, c => Number(c.cv || 0) + Number(c.mb || 0))
    const faturado = sumBy(docsDia, signedTotal)
    const semCaixa = docsDia.length > 0 && caixa === 0
    return {
      dia,
      documentos: docsDia.length,
      faturado,
      cityTax: sumBy(docsDia, signedCityTax),
      caixa,
      cartoes,
      tpa,
      diferenca: sub(faturado, caixa),
      semCaixa,
      // Os cartões da caixa (MB + CV) deviam aparecer no banco como TPA.
      tpaNaoBate: temTpa && !semCaixa && (cartoes > 0 || tpa > 0) && Math.abs(sub(tpa, cartoes)) > TPA_TOLERANCE,
    }
  }).filter(d => d.documentos || d.caixa || d.tpa)

  const faturado = sumBy(validos, signedTotal)
  const cityTax = sumBy(validos, signedCityTax)
  const caixa = sum(closesMes.map(cashCloseTotal))
  const fora = creditsMes.filter(creditCountsAsRevenue)
  const banco = sumBy(fora, c => c.valor)
  const porTipo = new Map()
  for (const c of fora) porTipo.set(c.tipo || 'Outra', sum([porTipo.get(c.tipo || 'Outra') || 0, c.valor]))
  const recebido = sum([caixa, banco])

  const porCanal = new Map()
  for (const d of validos) porCanal.set(d.canal || 'Sem canal', sum([porCanal.get(d.canal || 'Sem canal') || 0, signedTotal(d)]))

  const semRecibo = validos.filter(d => needsReceipt(d) && !d.recibos?.length)
  const recebidoAMenos = validos.filter(d => needsReceipt(d) && d.recibos?.length && !sameAmount(d.valor_recebido, d.total) && d.valor_recebido < d.total)
  const notasCredito = validos.filter(d => d.tipo === 'NC')
  const anuladas = doMes.filter(d => d.estado === 'A')
  const meios = new Map()
  for (const d of validos) for (const m of d.meios || []) meios.set(m, (meios.get(m) || 0) + 1)

  return {
    month,
    documentos: validos.length,
    faturas: validos.filter(d => d.tipo !== 'NC').length,
    faturado,
    cityTax,
    semCityTax: sub(faturado, cityTax),
    caixa,
    banco,
    bancoPorTipo: [...porTipo].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total),
    tpa: sumBy(creditsMes.filter(c => c.tipo === TPA), c => c.valor),
    recebido,
    diferenca: sub(faturado, recebido),
    porCanal: [...porCanal].map(([canal, total]) => ({ canal, total })).sort((a, b) => b.total - a.total),
    dias,
    diasSemCaixa: dias.filter(d => d.semCaixa),
    diasTpaNaoBate: dias.filter(d => d.tpaNaoBate),
    temTpa,
    semRecibo,
    recebidoAMenos,
    notasCredito,
    anuladas,
    anuladasSemSubstituicao: annulledWithoutReplacement(doMes),
    saltos: numberingGaps(doMes),
    meios: [...meios].map(([meio, count]) => ({ meio, count })).sort((a, b) => b.count - a.count),
  }
}
