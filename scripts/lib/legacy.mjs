// Extrai os dados reais incorporados no HTML legado (FaturaClaro V36).
// Só avalia os literais de dados (arrays/objetos), nunca o código da página.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function scriptsOf(html) {
  const re = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi
  let js = ''
  let m
  while ((m = re.exec(html)) !== null) js += m[1] + '\n'
  return js
}

function literalAfter(js, varName) {
  const m = js.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*`))
  if (!m) throw new Error(`Variável ${varName} não encontrada no HTML legado`)
  const start = m.index + m[0].length
  let depth = 0
  let quote = null
  let escape = false
  for (let i = start; i < js.length; i++) {
    const ch = js[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return js.slice(start, i + 1)
    }
  }
  throw new Error(`Literal de ${varName} incompleto`)
}

function evalLiteral(js, varName) {
  return vm.runInContext(`(${literalAfter(js, varName)})`, vm.createContext({}), { timeout: 2000 })
}

export function loadLegacyData(htmlPath) {
  const js = scriptsOf(readFileSync(htmlPath, 'utf-8'))
  const DATA = evalLiteral(js, 'DATA')
  return {
    transactions: DATA.transactions,
    month: DATA.month,
    note: DATA.note,
    items: evalLiteral(js, 'ITEMS'),
    cashInvoices: evalLiteral(js, 'CASH_INVOICES'),
    cashCloses: evalLiteral(js, 'ALL_CASH_DATA'),
  }
}

// Soma exata em milésimos (os fechos têm valores com 3 casas decimais).
export function sumMilli(values) {
  return values.reduce((acc, v) => acc + Math.round(Number(v || 0) * 1000), 0) / 1000
}

export function legacySummary(d) {
  const companyTransfers = d.transactions.filter(t => t.categoria === 'Transferência — empresa')
  return {
    bank: { count: d.transactions.length, total: sumMilli(d.transactions.map(t => t.valor)) },
    bankCompanyTransfers: { count: companyTransfers.length, total: sumMilli(companyTransfers.map(t => t.valor)) },
    cashInvoices: { count: d.cashInvoices.length, total: sumMilli(d.cashInvoices.map(t => t.valor)) },
    items: {
      count: d.items.length,
      total: sumMilli(d.items.map(i => i.gasto)),
      withoutValue: d.items.filter(i => i.gasto == null).length,
    },
    cashCloses: {
      count: d.cashCloses.length,
      dinheiro: sumMilli(d.cashCloses.map(c => c.money)),
      cv: sumMilli(d.cashCloses.map(c => c.cv)),
      mb: sumMilli(d.cashCloses.map(c => c.mb)),
      cityMb: sumMilli(d.cashCloses.map(c => c.cityMB)),
      total: sumMilli(d.cashCloses.flatMap(c => [c.money, c.cv, c.mb, c.cityMB])),
      firstDate: d.cashCloses.map(c => c.date).sort()[0],
      lastDate: d.cashCloses.map(c => c.date).sort().at(-1),
    },
  }
}
