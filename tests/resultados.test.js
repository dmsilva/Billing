import { describe, expect, it } from 'vitest'
import { accountingRows, bankToRow, invoiceToRow, monthResult, yearResults } from '../src/lib/finance.js'

const cats = new Map([[1, { nome: 'Salários', conta_como_despesa: true }], [2, { nome: 'Transferência — empresa', conta_como_despesa: false }], [3, { nome: 'Limpeza', conta_como_despesa: true }]])
const props = new Map()
const bank = [
  { id: 1, data_mov: '2026-09-05', descricao: 'TRF ORDENADO', categoria_id: 1, valor: 1000 },
  { id: 2, data_mov: '2026-09-06', descricao: 'TRF EMPRESA B', categoria_id: 2, valor: 5000 },
  { id: 3, data_mov: '2026-09-07', descricao: 'LIMPEZAS LDA', categoria_id: 3, valor: 200.1 },
  { id: 4, data_mov: '2026-10-02', descricao: 'LIMPEZAS LDA', categoria_id: 3, valor: 3000 },
].map(t => bankToRow(t, cats, props))
const inv = [
  { id: 1, data: '2026-09-10', pagamento: 'Numerário', estado: 'Validada', valor: 50, categoria_id: 3 },
  { id: 2, data: '2026-09-11', pagamento: 'CGD', estado: 'Validada', valor: 200.1, categoria_id: 3 },
].map(i => invoiceToRow(i, cats, props))
const data = {
  expenseRows: accountingRows(bank, inv),
  closes: [
    { data: '2026-09-01', turno: '7h', dinheiro: 100.5, cv: 20, mb: 300, city_mb: 10 },
    { data: '2026-10-01', turno: '7h', dinheiro: 10, cv: 0, mb: 0, city_mb: 0 },
  ],
  credits: [
    { data_mov: '2026-09-03', tipo: 'Expedia', valor: 800 },
    { data_mov: '2026-09-04', tipo: 'TPA / Multibanco', valor: 310 },
    { data_mov: '2026-09-04', tipo: 'Depósito', valor: 100 },
    { data_mov: '2026-09-04', tipo: 'Transferência', valor: 150, conta_como_entrada: false },
    { data_mov: '2026-09-05', tipo: 'Transferência', valor: 120 },
  ],
}

describe('resultado do mês', () => {
  const m = monthResult('2026-09', data)
  it('faturado = caixa + entradas do banco que não vêm da caixa', () => {
    expect(m.caixa.total).toBe(430.5)
    expect(m.banco).toBe(920)
    expect(m.faturado).toBe(1350.5)
    expect(m.foraDoFaturado).toBe(560)
  })
  it('despesas não somam faturas CGD nem transferências entre empresas', () => {
    expect(m.despesas).toBe(1250.1)
    expect(m.salarios).toBe(1000)
    expect(m.resultado).toBe(100.4)
  })
  it('assinala mês sem entradas do banco', () => {
    expect(monthResult('2026-10', data).semEntradasBanco).toBe(true)
  })
})

describe('resultado do ano', () => {
  const y = yearResults('2026', data)
  it('soma só os meses completos (caixa e extrato) e lista os meses com prejuízo', () => {
    expect(y.comDados.map(m => m.month)).toEqual(['2026-09', '2026-10'])
    expect(y.completos.map(m => m.month)).toEqual(['2026-09', '2026-10'])
    expect(y.resultado).toBe(-2889.6)
    expect(y.mesesComPrejuizo).toEqual(['2026-10'])
  })
  it('um mês só com caixa (sem extrato) não conta como lucro', () => {
    const y2 = yearResults('2026', { ...data, closes: [...data.closes, { data: '2026-08-01', turno: '7h', dinheiro: 5000, cv: 0, mb: 0, city_mb: 0 }] })
    expect(y2.incompletos.map(m => m.month)).toEqual(['2026-08'])
    expect(y2.resultado).toBe(-2889.6)
  })
})

describe('encargos com pessoal', () => {
  it('custo com pessoal = salários + TSU + IRS, sem mexer nas despesas', () => {
    const m = monthResult('2026-09', { ...data, encargos: [{ mes: '2026-09', tsu: 230.5, irs: 100 }] })
    expect(m.pessoal).toBe(1330.5)
    expect(m.despesas).toBe(1250.1)
  })
})
