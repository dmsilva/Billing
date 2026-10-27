// Conferência e classificação automáticas das faturas.
//  - Categoria: primeiro a que já foi usada para o mesmo fornecedor, depois regras por nome.
//  - Extrato: a fatura enviada pela receção liga-se à saída CGD com o mesmo valor (de 2 dias
//    antes a 7 depois da data da fatura), só quando a correspondência é única dos dois lados.
import { daysBetween } from './dates.js'
import { sameAmount } from './money.js'
import { ruleCategory } from './bankImport.js'

const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// Palavras que não identificam o fornecedor.
const STOP = new Set(['LDA', 'SA', 'UNIPESSOAL', 'UNIP', 'COMERCIO', 'COM', 'DISTRIBUICAO', 'SOCIEDADE', 'PORTUGAL', 'PORTUGUESA', 'LISBOA', 'LOJA', 'ALIMENTAR', 'ALIMENTARES', 'RESTAURACAO', 'SERVICOS', 'EMPRESA', 'COMPANHIA'])
export const supplierKey = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).join(' ')
const supplierWords = s => supplierKey(s).split(' ').filter(w => w.length >= 4)

// [expressão sobre o nome do fornecedor, categoria]
export const INVOICE_RULES = [
  [/PINGO DOCE/, 'Supermercado — Pingo Doce'],
  [/CONTINENTE|MODELO CONTINENTE/, 'Supermercado — Continente'],
  [/\bLIDL\b/, 'Supermercado — Lidl'],
  [/\bMAKRO\b/, 'Supermercado — Makro'],
  [/PADARIA PORTUGUESA/, 'Padaria Portuguesa'],
  [/GRAO (DE )?TRIGO|PADARIA|PANIFICA|PADEIR/, 'Fornecedor — padeiro / Grão Trigo'],
  [/PASTELARIA|CONFEITARIA/, 'Pequeno-almoço / pastelaria'],
  [/\bIKEA\b/, 'IKEA'],
  [/FARMACIA/, 'Farmácia'],
  [/\bEDP\b/, 'Eletricidade / EDP'],
  [/ENDESA/, 'Eletricidade / Endesa'],
  [/VODAFONE/, 'Telecomunicações — Vodafone'],
  [/AMAZON/, 'Compras online / Amazon'],
  [/\bCTT\b/, 'CTT / Correios'],
  [/LEROY MERLIN|BRICOMARCHE|\bAKI\b|MAXMAT/, 'Manutenção / bricolage'],
  [/SKLUM|MAISONS DU MONDE|ZARA HOME|JYSK/, 'Mobiliário / decoração'],
  [/WORTEN|FNAC|MEDIA MARKT/, 'Equipamento / eletrónica'],
  [/HETIENE/, 'Fornecedor — fruta (Hetiene Faria)'],
]

const UNCLASSIFIED = new Set(['Por classificar', 'Outros / por classificar'])
export const isUnclassified = (categoriaId, categoriesById) => !categoriaId || UNCLASSIFIED.has(categoriesById.get(categoriaId)?.nome)

// Categoria mais usada por fornecedor, a partir das faturas já classificadas.
export function categoryHistory(invoices, categoriesById) {
  const counts = new Map()
  for (const i of invoices) {
    if (isUnclassified(i.categoria_id, categoriesById) || i.estado === 'Rejeitada') continue
    const k = supplierKey(i.fornecedor)
    if (!k) continue
    const m = counts.get(k) || new Map()
    m.set(i.categoria_id, (m.get(i.categoria_id) || 0) + 1)
    counts.set(k, m)
  }
  const best = new Map()
  for (const [k, m] of counts) best.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0])
  return best
}

export function suggestInvoiceCategory(inv, history, categories) {
  const k = supplierKey(inv.fornecedor)
  if (k && history.has(k)) return history.get(k)
  const name = norm(inv.fornecedor)
  if (!name) return null
  const nome = INVOICE_RULES.find(([re]) => re.test(name))?.[1] || ruleCategory(name)
  return nome ? categories.find(c => c.nome.toLowerCase() === nome.toLowerCase())?.id ?? null : null
}

// O texto do banco menciona o fornecedor (alguma palavra com 4 ou mais letras).
export function mentionsSupplier(fornecedor, descricao) {
  const d = ` ${norm(descricao)} `
  return supplierWords(fornecedor).some(w => d.includes(` ${w}`))
}

export const canAutoMatch = i => i.origem === 'rececao' && !i.bank_transaction_id && !i.payment_id && i.pagamento !== 'Por pagar'
  && i.estado !== 'Rejeitada' && i.valor != null && i.data

// Pares fatura ↔ movimento sem ambiguidade. used: ids de movimentos já ligados a outra coisa.
export function matchInvoicesToBank(invoices, transactions, used = new Set()) {
  const free = transactions.filter(t => !used.has(t.id))
  const options = new Map()
  for (const inv of invoices.filter(canAutoMatch)) {
    const cands = free.filter(t => {
      if (!sameAmount(Math.abs(Number(t.valor)), Number(inv.valor))) return false
      const d = daysBetween(inv.data, t.data_mov)
      if (d < -2 || d > 7) return false
      // Paga em numerário segundo a receção: só se o movimento tiver o nome do fornecedor.
      return inv.pagamento === 'CGD' || mentionsSupplier(inv.fornecedor, t.descricao)
    })
    if (cands.length === 1) options.set(inv.id, cands[0].id)
  }
  const perTx = new Map()
  for (const tx of options.values()) perTx.set(tx, (perTx.get(tx) || 0) + 1)
  return [...options].filter(([, tx]) => perTx.get(tx) === 1).map(([invoiceId, txId]) => ({ invoiceId, txId }))
}

// Alterações a gravar: faturas (categoria e/ou ligação ao extrato) e movimentos sem categoria.
export function planAutoUpdates({ invoices, transactions, categories, payments = [], userId = null, now = new Date().toISOString() }) {
  const categoriesById = new Map(categories.map(c => [c.id, c]))
  const history = categoryHistory(invoices, categoriesById)
  const used = new Set([...invoices.map(i => i.bank_transaction_id), ...payments.map(p => p.bank_transaction_id)].filter(Boolean))
  const txById = new Map(transactions.map(t => [t.id, t]))
  const invoicePatches = new Map()
  const txPatches = new Map()
  const patch = (id, p) => invoicePatches.set(id, { ...(invoicePatches.get(id) || {}), ...p })

  const categoryOf = new Map()
  for (const inv of invoices) {
    // Os dados migrados (legado) ficam como estão; só se classificam faturas novas.
    if (inv.origem === 'legado' || inv.estado === 'Rejeitada' || !isUnclassified(inv.categoria_id, categoriesById)) { categoryOf.set(inv.id, inv.categoria_id); continue }
    const id = suggestInvoiceCategory(inv, history, categories)
    categoryOf.set(inv.id, id || inv.categoria_id)
    if (id && id !== inv.categoria_id) patch(inv.id, { categoria_id: id })
  }

  const invById = new Map(invoices.map(i => [i.id, i]))
  for (const { invoiceId, txId } of matchInvoicesToBank(invoices, transactions, used)) {
    const validate = invById.get(invoiceId).estado !== 'Validada' ? { estado: 'Validada', validated_by: userId, validated_at: now } : {}
    patch(invoiceId, { bank_transaction_id: txId, pagamento: 'CGD', ...validate })
    const tx = txById.get(txId)
    const cat = categoryOf.get(invoiceId)
    if (cat && !isUnclassified(cat, categoriesById) && isUnclassified(tx.categoria_id, categoriesById)) txPatches.set(txId, { categoria_id: cat })
  }
  return {
    invoices: [...invoicePatches].map(([id, p]) => ({ id, patch: p })),
    transactions: [...txPatches].map(([id, p]) => ({ id, patch: p })),
  }
}
