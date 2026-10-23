// Alterações a várias faturas de uma vez (Recebidas). Devolve o que gravar em cada fatura
// ou o motivo para a deixar como está; segue as mesmas regras do editor da fatura.
import { todayIso } from './dates.js'

export const BULK_ACTIONS = {
  'por-pagar': 'Passar a Por liquidar',
  numerario: 'Marcar como paga em numerário',
  cgd: 'Marcar como paga por CGD',
  validar: 'Validar',
}

export function bulkPatch(inv, action, { userId, today = todayIso(), now = new Date().toISOString() } = {}) {
  const pagamento = { 'por-pagar': 'Por pagar', numerario: 'Numerário', cgd: 'CGD' }[action]
  if (pagamento) {
    if (inv.payment_id) return { skip: 'já liquidada num pagamento agrupado' }
    if (inv.pagamento === pagamento) return { skip: 'já estava assim' }
    if (pagamento === 'Por pagar' && inv.estado === 'Rejeitada') return { skip: 'rejeitada' }
    const patch = { pagamento, bank_transaction_id: null }
    if (pagamento === 'Por pagar') patch.liquidada_em = null
    else if (inv.pagamento === 'Por pagar') patch.liquidada_em = today
    return { patch }
  }
  if (action === 'validar') {
    if (inv.estado === 'Validada') return { skip: 'já validada' }
    if (inv.valor == null) return { skip: 'sem valor' }
    return { patch: { estado: 'Validada', validated_by: userId, validated_at: now } }
  }
  return { skip: 'ação desconhecida' }
}

// Pesquisa por fornecedor, documento, descrição ou valor (12,30 ou 12.30).
export function matchesInvoice(r, q) {
  const t = String(q || '').trim().toLowerCase()
  if (!t) return true
  const v = r.valor == null ? '' : `${Number(r.valor).toFixed(2)} ${Number(r.valor).toFixed(2).replace('.', ',')}`
  return `${r.fornecedor} ${r.documento} ${r.descricao} ${r.categoria} ${r.source?.enviado_por || ''} ${v}`.toLowerCase().includes(t)
}
