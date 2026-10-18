import { describe, expect, it } from 'vitest'
import { legacy, legacyAsDb } from './helpers.js'
import { accountingRows, applyFilters, bankToRow, breakfastAnalysis, byCategory, byMonth, byProperty, bySupplier, cashEntries, invoiceCountsAsExpense, invoiceToRow, totals, attentionCounts } from '../src/lib/finance.js'

const db = legacyAsDb()
const bankRows = db.bank.map(t => bankToRow(t, db.catsById, db.propsById))
const invoiceRows = db.invoices.map(i => invoiceToRow(i, db.catsById, db.propsById))
const rows = accountingRows(bankRows, invoiceRows)

describe('totais contabilísticos dos dados reais migrados (julho 2026)', () => {
  it('Despesas CGD excluem as transferências entre empresas', () => {
    expect(totals(rows).cgd).toBe(119586.02) // 124 736,02 − 5 150,00
  })
  it('Numerário soma as 13 faturas pagas em dinheiro', () => {
    expect(totals(rows).numerario).toBe(1354.49)
  })
  it('Total contabilístico = CGD + numerário', () => {
    expect(totals(rows).total).toBe(120940.51)
  })
  it('é igual ao cálculo do HTML legado', () => {
    // Legado: expenseRows(allRows()) = movimentos CGD sem "Transferência — empresa" + CASH_INVOICES
    const legacyTotal = legacy.transactions.filter(t => t.categoria !== 'Transferência — empresa').reduce((a, t) => a + Math.round(t.valor * 100), 0)
      + legacy.cashInvoices.reduce((a, t) => a + Math.round(t.valor * 100), 0)
    expect(Math.round(totals(rows).total * 100)).toBe(legacyTotal)
  })
  it('categorias somam o total', () => {
    const cats = byCategory(rows)
    expect(cats.reduce((a, c) => a + Math.round(c.total * 100), 0)).toBe(12094051)
    expect(cats.find(c => c.nome === 'Transferência — empresa')).toBeUndefined()
    expect(cats[0]).toMatchObject({ nome: 'Rendas', total: 26229.36, cgd: 26229.36, numerario: 0 })
  })
  it('separa CGD e numerário por imóvel', () => {
    expect(byProperty(rows)).toEqual([{ nome: "Chalet D'Ávila", count: 154, cgd: 119586.02, numerario: 1354.49, total: 120940.51 }])
  })
  it('agrupa salários e financiamentos nos maiores fornecedores', () => {
    const sup = bySupplier(rows)
    const sal = sup.find(s => s.nome === 'Salários (total)')
    // 9 movimentos "Salários" + 8 transferências "ORDE…/ORDENA…" ainda por classificar
    // ("GUILHERME FONTOURA OR …" vem truncado no extrato e não é reconhecido automaticamente)
    expect(sal.count).toBe(17)
    expect(sup.find(s => s.nome === 'Financiamentos (total)')).toBeTruthy()
  })
  it('totais mensais', () => {
    const m = byMonth(rows, ['2026-06', '2026-07', '2026-08'])
    expect(m.map(x => x.total)).toEqual([0, 120940.51, 0])
  })
})

describe('regras de contabilização', () => {
  const cat = new Map([[1, { nome: 'Alimentação', conta_como_despesa: true }]])
  const props = new Map([[1, 'Chalet do Lago']])
  const inv = over => invoiceToRow({ id: 1, data: '2026-08-01', pagamento: 'Numerário', valor: 10, estado: 'Por validar', categoria_id: 1, imovel_id: 1, ...over }, cat, props)

  it('fatura paga por CGD não soma outra vez (já está no extrato)', () => {
    expect(invoiceCountsAsExpense(inv({ pagamento: 'CGD' }).source)).toBe(false)
    expect(accountingRows([], [inv({ pagamento: 'CGD' })])).toHaveLength(0)
  })
  it('fatura rejeitada ou sem valor não entra', () => {
    expect(accountingRows([], [inv({ estado: 'Rejeitada' }), inv({ valor: null })])).toHaveLength(0)
  })
  it('fatura em numerário por validar entra (como no legado)', () => {
    expect(totals(accountingRows([], [inv({})])).numerario).toBe(10)
  })
  it('categoria marcada como não-despesa fica fora', () => {
    const c2 = new Map([[1, { nome: 'Transferência — empresa', conta_como_despesa: false }]])
    const b = bankToRow({ id: 1, data_mov: '2026-07-24', descricao: 'TRF', valor: 100, categoria_id: 1, imovel_id: 1 }, c2, props)
    expect(accountingRows([b], [])).toHaveLength(0)
  })
  it('filtros globais', () => {
    expect(applyFilters(rows, { payment: 'Numerário' })).toHaveLength(13)
    expect(applyFilters(rows, { search: 'sklum' })).toHaveLength(2)
    expect(applyFilters(rows, { month: '2026-08' })).toHaveLength(0)
    expect(applyFilters(rows, { property: 'Chalet do Lago' })).toHaveLength(0)
  })
})

describe('entradas de caixa', () => {
  it('soma os 819 fechos reais (Dinheiro + CV + MB + City MB)', () => {
    const e = cashEntries(db.closes)
    expect(e).toMatchObject({ dinheiro: 32525.47, cv: 440347.392, mb: 225332.324, cityMb: 2553.8, total: 700758.986, dias: 273 })
  })
  it('julho de 2026', () => {
    const july = cashEntries(db.closes.filter(c => c.data.startsWith('2026-07')))
    expect(july.dias).toBe(31)
  })
})

describe('produtos e pequeno-almoço', () => {
  const b = breakfastAnalysis(db.lines)
  it('só conta tipos de pequeno-almoço com valor', () => {
    const legacyTotal = legacy.items.filter(i => ['Pequeno-almoço', 'Laticínios', 'Fruta', 'Bebidas'].includes(i.tipo) && i.gasto > 0).reduce((a, i) => a + Math.round(i.gasto * 100), 0)
    expect(Math.round(b.total * 100)).toBe(legacyTotal)
  })
  it('identifica o fornecedor pela observação', () => {
    expect(b.suppliers.find(s => s.nome === 'Grão Trigo').total).toBe(1241.97)
    expect(b.suppliers.find(s => s.nome === 'Makro').total).toBe(0)
  })
  it('exclui bebidas alcoólicas', () => {
    expect(breakfastAnalysis([{ produto: 'Vinho tinto', tipo: 'Bebidas', valor: 10 }]).total).toBe(0)
  })
})

describe('alertas', () => {
  it('conta movimentos por classificar e caixas por conferir', () => {
    const a = attentionCounts({ rows: bankRows, invoices: db.invoices, closes: db.closes, checks: [{ cash_close_id: 1, tipo: 'cv', valor_esperado: 210.68, valor_real: 200 }], month: '' })
    expect(a.porClassificar).toBe(10)
    expect(a.caixasPorConferir).toBe(819)
    expect(a.porValidar).toBe(13)
    expect(a.diferencas).toBe(1)
  })
})
