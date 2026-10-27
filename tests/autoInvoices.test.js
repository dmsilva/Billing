import { describe, expect, it } from 'vitest'
import { matchInvoicesToBank, mentionsSupplier, planAutoUpdates, suggestInvoiceCategory, categoryHistory } from '../src/lib/autoInvoices.js'

const categories = [
  { id: 1, nome: 'Por classificar' },
  { id: 2, nome: 'Supermercado — Pingo Doce' },
  { id: 3, nome: 'Supermercado — Continente' },
  { id: 4, nome: 'Fornecedor — padeiro / Grão Trigo' },
  { id: 5, nome: 'Bebidas' },
  { id: 6, nome: 'Produtos de limpeza' },
]
const byId = new Map(categories.map(c => [c.id, c]))
const inv = (o) => ({ id: 1, origem: 'rececao', estado: 'Por validar', pagamento: 'CGD', categoria_id: null, bank_transaction_id: null, payment_id: null, ...o })

describe('categoria automática', () => {
  it('reconhece Pingo Doce, Continente e Grão de Trigo pelo nome', () => {
    const h = new Map()
    expect(suggestInvoiceCategory({ fornecedor: 'Pingo Doce - Distribuição Alimentar, S.A.' }, h, categories)).toBe(2)
    expect(suggestInvoiceCategory({ fornecedor: 'MODELO CONTINENTE HIPERMERCADOS' }, h, categories)).toBe(3)
    expect(suggestInvoiceCategory({ fornecedor: 'Grão de Trigo, Lda' }, h, categories)).toBe(4)
    expect(suggestInvoiceCategory({ fornecedor: 'Manuel J. Cabral' }, h, categories)).toBe(6)
    expect(suggestInvoiceCategory({ fornecedor: 'Fornecedor desconhecido' }, h, categories)).toBe(null)
  })
  it('a categoria já usada para o fornecedor ganha às regras', () => {
    const h = categoryHistory([{ fornecedor: 'Pingo Doce, SA', categoria_id: 5, estado: 'Validada' }, { fornecedor: 'Pingo Doce', categoria_id: 1 }], byId)
    expect(suggestInvoiceCategory({ fornecedor: 'PINGO DOCE' }, h, categories)).toBe(5)
  })
})

describe('conferência com o extrato', () => {
  const txs = [
    { id: 10, data_mov: '2026-10-03', descricao: 'COMPRA 1234 PINGO DOCE LISBOA', valor: 45.2 },
    { id: 11, data_mov: '2026-10-20', descricao: 'TRF FORNECEDOR X', valor: 45.2 },
    { id: 12, data_mov: '2026-10-05', descricao: 'COMPRA CONTINENTE', valor: 12 },
  ]
  it('liga a fatura à única saída com o mesmo valor perto da data', () => {
    expect(matchInvoicesToBank([inv({ fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-02' })], txs)).toEqual([{ invoiceId: 1, txId: 10 }])
  })
  it('não liga quando há duas saídas possíveis ou nenhuma', () => {
    const two = [...txs, { id: 13, data_mov: '2026-10-04', descricao: 'COMPRA PINGO DOCE', valor: 45.2 }]
    expect(matchInvoicesToBank([inv({ fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-02' })], two)).toEqual([])
    expect(matchInvoicesToBank([inv({ fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-09-01' })], txs)).toEqual([])
  })
  it('não liga duas faturas ao mesmo movimento nem movimentos já usados', () => {
    const a = inv({ id: 1, fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-02' })
    const b = inv({ id: 2, fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-01' })
    expect(matchInvoicesToBank([a, b], txs)).toEqual([])
    expect(matchInvoicesToBank([a], txs, new Set([10]))).toEqual([])
  })
  it('em numerário só liga se o movimento tiver o nome do fornecedor', () => {
    expect(matchInvoicesToBank([inv({ pagamento: 'Numerário', fornecedor: 'Continente', valor: 12, data: '2026-10-05' })], txs)).toEqual([{ invoiceId: 1, txId: 12 }])
    expect(matchInvoicesToBank([inv({ pagamento: 'Numerário', fornecedor: 'Padaria Sol', valor: 12, data: '2026-10-05' })], txs)).toEqual([])
    expect(mentionsSupplier('Pingo Doce, S.A.', 'COMPRA PINGO DOCE')).toBe(true)
  })
  it('ignora faturas por pagar, rejeitadas, já ligadas ou que não vieram da receção', () => {
    const base = { fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-02' }
    for (const o of [{ pagamento: 'Por pagar' }, { estado: 'Rejeitada' }, { bank_transaction_id: 99 }, { origem: 'legado' }, { payment_id: 3 }]) {
      expect(matchInvoicesToBank([inv({ ...base, ...o })], txs)).toEqual([])
    }
  })
  it('planeia validar a fatura, passar a CGD e classificar o movimento sem categoria', () => {
    const plan = planAutoUpdates({
      invoices: [inv({ fornecedor: 'Pingo Doce', valor: 45.2, data: '2026-10-02', pagamento: 'Numerário' })],
      transactions: [{ ...txs[0], categoria_id: 1 }],
      categories, userId: 'u1', now: 'T',
    })
    expect(plan.invoices).toEqual([{ id: 1, patch: { categoria_id: 2, bank_transaction_id: 10, pagamento: 'CGD', estado: 'Validada', validated_by: 'u1', validated_at: 'T' } }])
    expect(plan.transactions).toEqual([{ id: 10, patch: { categoria_id: 2 } }])
  })
})
