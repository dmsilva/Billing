// Regras financeiras da FaturaClaro.
//
// Tesouraria vs. contabilidade:
//  - "Despesas CGD" = saídas do extrato bancário, exceto categorias que não contam como
//    despesa (ex.: "Transferência — empresa", que é dinheiro entre empresas do grupo).
//  - "Numerário" = faturas/recibos pagos em dinheiro. Não saem da CGD, mas são despesa
//    contabilística e base para o apuramento de IVA.
//  - Faturas pagas por CGD são documentos de suporte de um movimento do extrato: nunca são
//    somadas outra vez (evita dupla contagem).
//  - Faturas rejeitadas ou ainda sem valor não entram nos totais.
//  - Faturas "Por pagar" ficam fora dos totais até serem liquidadas (passam então a CGD ou Numerário).
//  - "Entradas de caixa" = Dinheiro + CV + MB + City MB dos fechos da caixa diária.
//    City MB é a taxa turística paga em MB: entra no faturado e sai nas despesas quando se paga à
//    Câmara (categoria "Taxa turística / CML"), por isso no resultado anula-se.
//  - "Entradas no banco" = créditos do extrato CGD (Expedia, Stripe, transferências de hóspedes…).
//    Nunca são despesa; as marcadas com conta_como_entrada=false (ex.: entre contas próprias) ficam fora.
import { sum, sumBy, sameAmount } from './money.js'
import { monthOf, monthsOfYear } from './dates.js'

export const PAYMENT_CGD = 'CGD'
export const PAYMENT_CASH = 'Numerário'
export const PAYMENT_UNPAID = 'Por pagar'
export const UNCLASSIFIED = ['Por classificar', 'Outros / por classificar']

export const SALARY_RE = /\bORDEN(?:ADO|ADOS|AR|OS|A)?\b|\bORDE\b|\bSAL[ÁA]RIO(?:S)?\b/i
export const FINANCING_RE = /COBRANCA\s+PRESTACAO|PRESTA[CÇ][AÃ]O/i

// Normaliza movimentos e faturas para um formato comum de "despesa".
// categories: Map id -> { nome, conta_como_despesa }; properties: Map id -> nome
export function bankToRow(t, categories, properties) {
  const cat = categories.get(t.categoria_id)
  return {
    kind: 'bank',
    id: t.id,
    data: t.data_mov,
    descricao: t.descricao,
    fornecedor: null,
    documento: null,
    categoria: cat?.nome || 'Por classificar',
    contaComoDespesa: cat ? cat.conta_como_despesa !== false : true,
    imovel: properties.get(t.imovel_id) || 'Sem imóvel',
    pagamento: PAYMENT_CGD,
    valor: Number(t.valor),
    saldo: t.saldo == null ? null : Number(t.saldo),
    source: t,
  }
}

export function invoiceToRow(inv, categories, properties) {
  const cat = categories.get(inv.categoria_id)
  return {
    kind: 'invoice',
    id: inv.id,
    data: inv.data,
    descricao: inv.descricao || '',
    fornecedor: inv.fornecedor || '',
    documento: inv.documento || '',
    categoria: cat?.nome || 'Por classificar',
    contaComoDespesa: cat ? cat.conta_como_despesa !== false : true,
    imovel: properties.get(inv.imovel_id) || 'Sem imóvel',
    pagamento: inv.pagamento,
    valor: inv.valor == null ? null : Number(inv.valor),
    estado: inv.estado,
    source: inv,
  }
}

// Uma fatura conta como despesa adicional (para além do extrato) só se for em numerário,
// não estiver rejeitada e já tiver valor.
export function invoiceCountsAsExpense(inv) {
  return inv.pagamento === PAYMENT_CASH && inv.estado !== 'Rejeitada' && inv.valor != null && Number.isFinite(Number(inv.valor))
}

// Linhas que entram na contabilidade: movimentos CGD + faturas em numerário válidas.
export function accountingRows(bankRows, invoiceRows) {
  return [
    ...bankRows.filter(r => r.contaComoDespesa),
    ...invoiceRows.filter(r => invoiceCountsAsExpense(r.source ?? r) && r.contaComoDespesa),
  ]
}

export function applyFilters(rows, f = {}) {
  const q = (f.search || '').trim().toLowerCase()
  return rows.filter(r =>
    (!f.month || monthOf(r.data) === f.month) &&
    (!f.year || String(r.data || '').startsWith(f.year)) &&
    (!f.property || r.imovel === f.property) &&
    (!f.payment || r.pagamento === f.payment) &&
    (!f.category || r.categoria === f.category) &&
    (!q || [r.descricao, r.fornecedor, r.documento, r.categoria, r.imovel, r.pagamento].join(' ').toLowerCase().includes(q)),
  )
}

export function totals(rows) {
  const cgd = sumBy(rows.filter(r => r.pagamento === PAYMENT_CGD), r => r.valor)
  const numerario = sumBy(rows.filter(r => r.pagamento === PAYMENT_CASH), r => r.valor)
  return { cgd, numerario, total: sum([cgd, numerario]) }
}

function groupSplit(rows, keyFn) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!map.has(k)) map.set(k, { nome: k, cgd: [], numerario: [], count: 0 })
    const g = map.get(k)
    g.count++
    ;(r.pagamento === PAYMENT_CGD ? g.cgd : g.numerario).push(r.valor)
  }
  return [...map.values()]
    .map(g => {
      const cgd = sum(g.cgd)
      const numerario = sum(g.numerario)
      return { nome: g.nome, count: g.count, cgd, numerario, total: sum([cgd, numerario]) }
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt'))
}

export const byCategory = rows => groupSplit(rows, r => r.categoria)
export const byProperty = rows => groupSplit(rows, r => r.imovel || 'Sem imóvel')

// Fornecedor: nas faturas é o fornecedor; no extrato é a descrição do movimento.
// Salários e financiamentos são agregados numa só linha (como no legado).
export function supplierKey(r) {
  const desc = String(r.descricao || r.fornecedor || '').toUpperCase()
  if (r.categoria === 'Salários' || (r.kind === 'bank' && SALARY_RE.test(desc))) return { nome: 'Salários (total)', grupo: 'Salários' }
  if (r.categoria === 'Prestações / financiamento' || FINANCING_RE.test(desc)) return { nome: 'Financiamentos (total)', grupo: 'Financiamentos' }
  return { nome: r.fornecedor || r.descricao || 'Sem identificação', grupo: r.categoria }
}

export function bySupplier(rows) {
  const map = new Map()
  for (const r of rows) {
    const { nome, grupo } = supplierKey(r)
    if (!map.has(nome)) map.set(nome, { nome, categoria: grupo, valores: [], cgd: [], numerario: [], count: 0 })
    const g = map.get(nome)
    g.valores.push(r.valor)
    ;(r.pagamento === PAYMENT_CGD ? g.cgd : g.numerario).push(r.valor)
    g.count++
  }
  return [...map.values()]
    .map(g => ({ nome: g.nome, categoria: g.categoria, count: g.count, cgd: sum(g.cgd), numerario: sum(g.numerario), total: sum(g.valores) }))
    .sort((a, b) => b.total - a.total)
}

export function byMonth(rows, months) {
  return months.map(key => {
    const inMonth = rows.filter(r => monthOf(r.data) === key)
    return { month: key, ...totals(inMonth) }
  })
}

export function cashCloseTotal(c) {
  return sum([c.dinheiro, c.cv, c.mb, c.city_mb])
}

export function cashEntries(closes) {
  return {
    dinheiro: sumBy(closes, c => c.dinheiro),
    cv: sumBy(closes, c => c.cv),
    mb: sumBy(closes, c => c.mb),
    cityMb: sumBy(closes, c => c.city_mb),
    total: sum(closes.map(cashCloseTotal)),
    dias: new Set(closes.map(c => c.data)).size,
  }
}

// Totais da caixa por mês (mais recente primeiro).
export function cashByMonth(closes) {
  const groups = new Map()
  for (const c of closes) {
    const m = monthOf(c.data)
    if (!groups.has(m)) groups.set(m, [])
    groups.get(m).push(c)
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([mes, list]) => ({ mes, ...cashEntries(list) }))
}

// ---------- Produtos / pequeno-almoço ----------

export const BREAKFAST_TYPES = new Set(['Pequeno-almoço', 'Laticínios', 'Fruta', 'Bebidas'])
const ALCOHOL_RE = /vinho|cerveja|rosé|tinto|imperial|espumante|licor|whisky|vodka|gin\b/i
export const BREAKFAST_SUPPLIERS = ['Grão Trigo', 'Pingo Doce', 'Continente', 'Lidl', 'Makro', 'Padaria Portuguesa']

export function lineSupplier(line) {
  if (line.fornecedor) return line.fornecedor
  const o = String(line.observacao || '').toLowerCase()
  return BREAKFAST_SUPPLIERS.find(n => o.includes(n.toLowerCase())) || null
}

export function isBreakfastLine(line) {
  const v = Number(line.valor)
  return BREAKFAST_TYPES.has(line.tipo) && Number.isFinite(v) && v > 0 && !(line.tipo === 'Bebidas' && ALCOHOL_RE.test(line.produto || ''))
}

export function breakfastAnalysis(lines) {
  const items = lines.filter(isBreakfastLine)
  const bySup = new Map(['Grão Trigo', 'Pingo Doce', 'Continente', 'Lidl', 'Makro'].map(n => [n, []]))
  for (const l of items) {
    const s = lineSupplier(l) || 'Outra / fonte não identificada'
    if (!bySup.has(s)) bySup.set(s, [])
    bySup.get(s).push(l.valor)
  }
  return {
    total: sumBy(items, l => l.valor),
    items: [...items].sort((a, b) => Number(b.valor) - Number(a.valor)),
    suppliers: [...bySup.entries()].map(([nome, vs]) => ({ nome, total: sum(vs) })).sort((a, b) => b.total - a.total),
  }
}

export const lineIsClosed = l => l.quantidade != null && l.valor != null

export function byProduct(lines) {
  const map = new Map()
  for (const l of lines) {
    const k = (l.produto || '').trim()
    if (!map.has(k)) map.set(k, { produto: k, tipo: l.tipo, unidade: l.unidade, quantidade: [], valor: [], count: 0, porConsolidar: 0 })
    const g = map.get(k)
    g.count++
    if (l.quantidade != null) g.quantidade.push(l.quantidade)
    if (l.valor != null) g.valor.push(l.valor)
    if (!lineIsClosed(l)) g.porConsolidar++
  }
  return [...map.values()]
    .map(g => ({ ...g, quantidade: g.quantidade.length ? sum(g.quantidade) : null, valor: g.valor.length ? sum(g.valor) : null }))
    .sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1))
}

export function byProductType(lines) {
  const map = new Map()
  for (const l of lines) {
    if (l.valor == null) continue
    const k = l.tipo || 'Outros'
    map.set(k, [...(map.get(k) || []), l.valor])
  }
  return [...map.entries()].map(([nome, vs]) => ({ nome, total: sum(vs) })).sort((a, b) => b.total - a.total)
}

// ---------- Faturas por liquidar ----------

export const isUnpaid = inv => inv.pagamento === PAYMENT_UNPAID && inv.estado !== 'Rejeitada'

// Faturas por pagar agrupadas por fornecedor (o pagamento costuma ser feito ao fornecedor de uma vez).
export function unpaidBySupplier(invoices) {
  const map = new Map()
  for (const inv of invoices.filter(isUnpaid)) {
    const nome = (inv.fornecedor || '').trim() || 'Sem fornecedor'
    const key = nome.toLowerCase()
    if (!map.has(key)) map.set(key, { nome, faturas: [] })
    map.get(key).faturas.push(inv)
  }
  return [...map.values()]
    .map(g => ({
      ...g,
      faturas: g.faturas.sort((a, b) => String(a.data).localeCompare(String(b.data))),
      total: sumBy(g.faturas, i => i.valor),
      semValor: g.faturas.filter(i => i.valor == null).length,
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt'))
}

// ---------- Entradas no banco ----------

export function bankCredits(credits, month) {
  const list = credits.filter(c => c.conta_como_entrada !== false && (!month || monthOf(c.data_mov) === month))
  const byTipo = new Map()
  for (const c of list) byTipo.set(c.tipo || 'Outra', [...(byTipo.get(c.tipo || 'Outra') || []), c])
  return {
    total: sumBy(list, c => c.valor),
    count: list.length,
    porTipo: [...byTipo].map(([tipo, l]) => ({ tipo, total: sumBy(l, c => c.valor), count: l.length })).sort((a, b) => b.total - a.total),
  }
}

// ---------- Alertas ----------

export function attentionCounts({ rows, invoices, closes, checks, month }) {
  const inMonth = d => !month || monthOf(d) === month
  const closeById = new Map(closes.map(c => [c.id, c]))
  const checksPerClose = new Map()
  for (const c of checks) checksPerClose.set(c.cash_close_id, (checksPerClose.get(c.cash_close_id) || 0) + 1)
  return {
    porValidar: invoices.filter(i => i.estado === 'Por validar' && inMonth(i.data)).length,
    porLiquidar: invoices.filter(isUnpaid).length,
    caixasPorConferir: closes.filter(c => inMonth(c.data) && (checksPerClose.get(c.id) || 0) < 3).length,
    porClassificar: rows.filter(r => r.kind === 'bank' && UNCLASSIFIED.includes(r.categoria) && inMonth(r.data)).length,
    diferencas: checks.filter(c => c.valor_real != null && !sameAmount(c.valor_real, c.valor_esperado) && inMonth(closeById.get(c.cash_close_id)?.data)).length,
  }
}

// Os produtos migrados do legado não têm data: foram todos lidos de talões de julho de 2026
// (o mês do extrato incorporado no HTML V36). Usamos esse mês para os filtros mensais.
export const LEGACY_ITEMS_MONTH = '2026-07'

export function lineMonth(line, invoicesById) {
  const d = line.data || invoicesById?.get(line.invoice_id)?.data
  if (d) return monthOf(d)
  return line.legacy_idx != null ? LEGACY_ITEMS_MONTH : ''
}

// ---------- Resultados (faturado − despesas) ----------
//
// Faturado = tudo o que a receção registou na caixa diária (dinheiro, CV, MB, City MB)
//          + entradas no banco que não passam pela caixa (Expedia, Booking, Airbnb, Stripe,
//            transferências de hóspedes, outras).
// Ficam fora do faturado, para não contar o mesmo dinheiro duas vezes:
//  - "TPA / Multibanco": é o dinheiro dos cartões da caixa (MB/CV) a chegar ao banco;
//  - "Depósito": é o numerário da caixa depositado no banco;
//  - entradas com conta_como_entrada=false (ex.: entre contas próprias).
// Despesas = saídas CGD que contam como despesa + faturas pagas em numerário (accountingRows).
export const CREDIT_FROM_CASH = new Set(['TPA / Multibanco', 'Depósito'])
export const creditCountsAsRevenue = c => c.conta_como_entrada !== false && !CREDIT_FROM_CASH.has(c.tipo)
export const isSalaryRow = r => supplierKey(r).grupo === 'Salários'

// encargos: [{ mes, tsu, irs }] (TSU e IRS pagos dentro dos "Gastos do mês"; não somam às despesas).
export function monthResult(month, { closes, credits, expenseRows, encargos = [] }) {
  const cx = cashEntries(closes.filter(c => monthOf(c.data) === month))
  const cr = credits.filter(c => monthOf(c.data_mov) === month)
  const bancoList = cr.filter(creditCountsAsRevenue)
  const banco = sumBy(bancoList, c => c.valor)
  const porTipo = new Map()
  for (const c of bancoList) porTipo.set(c.tipo || 'Outra', [...(porTipo.get(c.tipo || 'Outra') || []), c.valor])
  const ex = expenseRows.filter(r => monthOf(r.data) === month)
  const t = totals(ex)
  const salarios = sumBy(ex.filter(isSalaryRow), r => r.valor)
  const faturado = sum([cx.total, banco])
  const enc = encargos.find(e => e.mes === month)
  const tsu = Number(enc?.tsu || 0)
  const irs = Number(enc?.irs || 0)
  return {
    month,
    caixa: { dinheiro: cx.dinheiro, mb: cx.mb, cityTax: cx.cityMb, cv: cx.cv, total: cx.total, dias: cx.dias },
    banco,
    bancoPorTipo: [...porTipo].map(([tipo, vs]) => ({ tipo, total: sum(vs) })).sort((a, b) => b.total - a.total),
    foraDoFaturado: sumBy(cr.filter(c => !creditCountsAsRevenue(c)), c => c.valor),
    faturado,
    despesas: t.total,
    despesasCgd: t.cgd,
    despesasNumerario: t.numerario,
    salarios,
    tsu,
    irs,
    pessoal: sum([salarios, tsu, irs]),
    resultado: sum([faturado, -t.total]),
    // Avisos de dados em falta (o resultado do mês pode estar incompleto).
    semCaixa: cx.dias === 0,
    semEntradasBanco: cr.length === 0,
    semSaidas: ex.filter(r => r.kind === 'bank').length === 0,
    // Só há resultado quando o mês tem caixa diária e extrato de saídas; sem um dos lados o
    // "lucro" seria só o faturado (ou só despesas) e enganava.
    completo: cx.dias > 0 && ex.some(r => r.kind === 'bank'),
  }
}

export function yearResults(year, data) {
  const months = monthsOfYear(year).map(m => monthResult(m, data))
  const comDados = months.filter(m => m.faturado || m.despesas)
  const completos = comDados.filter(m => m.completo)
  const total = key => sum(completos.map(m => m[key]))
  return {
    months,
    comDados,
    completos,
    incompletos: comDados.filter(m => !m.completo),
    faturado: total('faturado'),
    despesas: total('despesas'),
    salarios: total('salarios'),
    pessoal: total('pessoal'),
    resultado: total('resultado'),
    mesesComPrejuizo: completos.filter(m => m.resultado < 0).map(m => m.month),
  }
}
