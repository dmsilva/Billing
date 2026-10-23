import { describe, expect, it } from 'vitest'
import { bulkPatch, matchesInvoice } from '../src/lib/invoiceBulk.js'

const opts = { userId: 'u1', today: '2026-10-23', now: 'T' }

describe('alterações em lote nas faturas', () => {
  it('passa a Por liquidar e limpa a ligação ao extrato', () => {
    expect(bulkPatch({ pagamento: 'Numerário', estado: 'Por validar' }, 'por-pagar', opts)).toEqual({ patch: { pagamento: 'Por pagar', bank_transaction_id: null, liquidada_em: null } })
  })
  it('sair de Por pagar regista a data da liquidação', () => {
    expect(bulkPatch({ pagamento: 'Por pagar' }, 'numerario', opts).patch.liquidada_em).toBe('2026-10-23')
  })
  it('não mexe em faturas liquidadas num pagamento agrupado nem rejeitadas', () => {
    expect(bulkPatch({ pagamento: 'Por pagar', payment_id: 3 }, 'cgd', opts).skip).toBeTruthy()
    expect(bulkPatch({ pagamento: 'CGD', estado: 'Rejeitada' }, 'por-pagar', opts).skip).toBeTruthy()
  })
  it('só valida faturas com valor', () => {
    expect(bulkPatch({ estado: 'Por validar', valor: null }, 'validar', opts).skip).toBe('sem valor')
    expect(bulkPatch({ estado: 'Por validar', valor: 10 }, 'validar', opts).patch).toEqual({ estado: 'Validada', validated_by: 'u1', validated_at: 'T' })
  })
  it('pesquisa por fornecedor ou valor', () => {
    const r = { fornecedor: 'Pingo Doce', documento: 'FT 1', descricao: '', categoria: 'x', valor: 12.3 }
    expect(matchesInvoice(r, 'pingo')).toBe(true)
    expect(matchesInvoice(r, '12,30')).toBe(true)
    expect(matchesInvoice(r, 'lidl')).toBe(false)
  })
})
