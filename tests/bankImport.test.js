import { describe, expect, it } from 'vitest'
import { legacy } from './helpers.js'
import { bankHash, classifyCredit, descriptionStem, goesToReception, guessPayer, matchTransfer, parseBankStatement, ruleCategory, suggestClassification } from '../src/lib/bankImport.js'

describe('extrato CGD', () => {
  const matrix = [
    ['Consultar saldos e movimentos'],
    ['Data mov.', 'Data valor', 'Descrição', 'Débito', 'Crédito', 'Saldo contabilístico'],
    ['01-07-2026', '01-07-2026', 'BBVA IFIC', '402,31', '', '57.086,61'],
    ['02-07-2026', '02-07-2026', 'TRF RECEBIDA', '', '1.000,00', '58.086,61'],
    ['03-08-2026', '03-08-2026', 'ENDESA ENERGIA', '45,02', '', '58.041,59'],
  ]
  it('separa as saídas das entradas', () => {
    const r = parseBankStatement(matrix)
    expect(r.error).toBeNull()
    expect(r.ignored).toBe(0)
    expect(r.credits.map(x => [x.data_mov, x.descricao, x.valor, x.saldo, x.tipo])).toEqual([['2026-07-02', 'TRF RECEBIDA', 1000, 58086.61, 'Transferência']])
    expect(r.records.map(x => [x.data_mov, x.descricao, x.valor, x.saldo])).toEqual([
      ['2026-07-01', 'BBVA IFIC', 402.31, 57086.61],
      ['2026-08-03', 'ENDESA ENERGIA', 45.02, 58041.59],
    ])
  })
  it('a chave coincide com a dos movimentos legados (reimportar julho não duplica)', () => {
    const r = parseBankStatement(matrix)
    expect(r.records[0].import_hash).toBe(bankHash(legacy.transactions[0]))
  })
  it('aceita montante com sinal', () => {
    const r = parseBankStatement([['Data', 'Descritivo', 'Montante', 'Saldo'], ['2026-08-01', 'COMPRA', '-12,30', '100'], ['2026-08-01', 'DEPOSITO', '50', '150']])
    expect(r.records).toHaveLength(1)
    expect(r.records[0].valor).toBe(12.3)
    expect(r.credits.map(c => [c.descricao, c.valor, c.tipo])).toEqual([['DEPOSITO', 50, 'Depósito']])
  })
  it('reconhece a origem das entradas', () => {
    expect(classifyCredit('TRAVELSCAPE LLC 4471')).toBe('Expedia')
    expect(classifyCredit('Expedia Lodging Partner')).toBe('Expedia')
    expect(classifyCredit('STRIPE PAYMENTS EUROPE')).toBe('Stripe')
    expect(classifyCredit('BOOKING.COM BV')).toBe('Booking')
    expect(classifyCredit('TRF CRED SEPA+ 0001234 DE JOHN SMITH')).toBe('Transferência')
    expect(classifyCredit('TRF MB WAY P/ ANA')).toBe('Transferência')
    expect(classifyCredit('JUROS CREDORES')).toBe('Outra')
    expect(goesToReception('Transferência')).toBe(true)
    expect(goesToReception('Expedia')).toBe(false)
    expect(guessPayer('TRF CRED SEPA+ 0001234 DE JOHN SMITH')).toBe('JOHN SMITH')
  })
  it('liga a entrada à transferência registada à mão com o mesmo valor', () => {
    const transfers = [
      { id: 1, data: '2026-10-01', valor: 250, bank_credit_id: null },
      { id: 2, data: '2026-10-04', valor: 250, bank_credit_id: null },
      { id: 3, data: '2026-10-04', valor: 99, bank_credit_id: null },
      { id: 4, data: '2026-10-05', valor: 250, bank_credit_id: 7 },
    ]
    expect(matchTransfer({ data_mov: '2026-10-05', valor: 250 }, transfers)?.id).toBe(2)
    expect(matchTransfer({ data_mov: '2026-10-05', valor: 250 }, transfers, new Set([2]))?.id).toBe(1)
    expect(matchTransfer({ data_mov: '2026-11-30', valor: 250 }, transfers)).toBeNull()
  })
  it('erro claro quando faltam colunas', () => {
    expect(parseBankStatement([['a', 'b']]).error).toMatch(/colunas/)
  })
  it('sugere a categoria a partir de movimentos anteriores', () => {
    expect(descriptionStem('PAD PORT D D AVILA 0000833311')).toBe('PAD PORT D D AVILA')
    const prev = [{ descricao: 'PAD PORT D D AVILA 0000833311', data_mov: '2026-07-01', categoria_id: 7, imovel_id: 1 }]
    expect(suggestClassification({ descricao: 'PAD PORT D D AVILA 0000912345' }, prev)).toEqual({ categoria_id: 7, imovel_id: 1 })
    expect(suggestClassification({ descricao: 'NOVO' }, prev)).toEqual({ categoria_id: null, imovel_id: null })
  })
})

describe('regras de fornecedores', () => {
  const cats = [{ id: 40, nome: 'Gás' }, { id: 41, nome: 'Manutenção / bricolage' }]
  it('reconhece os fornecedores indicados pela administração', () => {
    expect(ruleCategory('DD GDL CUR 12345678')).toBe('Gás')
    expect(ruleCategory('TRF CRISTINA MARGARID')).toBe('Transferência — Cristina')
    expect(ruleCategory('TRF MANUEL J CABRAL LDA')).toBe('Produtos de limpeza')
    expect(ruleCategory('COMPRA STI 4433')).toBe('Produtos de limpeza')
    expect(ruleCategory('TRF MARIO MENDES')).toBe('Manutenção / bricolage')
    expect(ruleCategory('GASTOS MES 6709416287')).toBe('Gastos do mês')
    expect(ruleCategory('PROC RECLAM 99881')).toBe('Devoluções a clientes (Booking)')
    expect(ruleCategory('COMPRA 441 DUQUE DE AVILA 0000833311')).toBe('Supermercado — Pingo Doce')
    expect(ruleCategory('441 DUQUE AVILA')).toBe('Supermercado — Pingo Doce')
    expect(ruleCategory('PAD PORT D D AVILA')).toBeNull()
    expect(ruleCategory('INSTITUTO')).toBeNull()
  })
  it('a regra ganha ao movimento anterior e indica a categoria a criar', () => {
    const prev = [{ descricao: 'DD GDL CUR 10001', data_mov: '2026-07-01', categoria_id: 99, imovel_id: 2 }]
    expect(suggestClassification({ descricao: 'DD GDL CUR 10002' }, prev, cats)).toEqual({ categoria_id: 40, imovel_id: 2 })
    expect(suggestClassification({ descricao: 'PROC RECLAM 1' }, [], cats)).toEqual({ categoria_id: null, categoria_nova: 'Devoluções a clientes (Booking)', imovel_id: null })
  })
})
