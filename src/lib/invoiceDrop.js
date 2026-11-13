// Faturas arrastadas para a aplicação: junta o QR AT e a leitura automática num rascunho
// que a administradora revê antes de gravar, e procura faturas já registadas iguais.
// Lógica pura, usada no navegador e nos testes.
import { matchProperty, normalizeReading } from './invoiceReading.js'
import { ruleFor, supplierKey } from './autoInvoices.js'
import { parseMoney } from './money.js'

const formatAmount = n => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','))
const cents = v => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100))

// "FT 2026A/123", "ft2026a-123" e "FT 2026 A/123" são o mesmo documento.
export const docKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Documentos que já vêm pagos: fatura-recibo, fatura simplificada (talão de loja), venda a dinheiro, talão e recibo.
const PAID_QR = new Set(['FR', 'FS', 'VD', 'TV', 'RG', 'RC'])
const PAID_AI = new Set(['fatura_recibo', 'fatura_simplificada', 'venda_a_dinheiro', 'talao', 'recibo'])
const AI_TIPO_NOME = { fatura: 'Fatura', fatura_recibo: 'Fatura-recibo', fatura_simplificada: 'Fatura simplificada', venda_a_dinheiro: 'Venda a dinheiro', talao: 'Talão', recibo: 'Recibo', nota_credito: 'Nota de crédito' }
export const PAY_FROM_READING = { numerario: 'Numerário', cartao: 'CGD', transferencia: 'CGD' }

const NIF_RE = /NIF(?: do fornecedor)?:\s*(\d{9})/i
const ATCUD_RE = /ATCUD:\s*([A-Z0-9-]+)/i
export const nifOf = inv => NIF_RE.exec(inv?.observacoes || '')?.[1] || null
export const atcudOf = inv => ATCUD_RE.exec(inv?.observacoes || '')?.[1]?.toUpperCase() || null

// A fatura mais recente do mesmo NIF dá o nome do fornecedor, a categoria e o imóvel já usados.
export function supplierFromHistory(nif, invoices) {
  if (!nif) return null
  const same = (invoices || []).filter(i => i.estado !== 'Rejeitada' && i.fornecedor && nifOf(i) === nif)
  if (!same.length) return null
  const last = same.sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id)[0]
  return { fornecedor: last.fornecedor, categoria_id: last.categoria_id ?? null, imovel_id: last.imovel_id ?? null }
}

// qr: resultado de parseQrAT (ou null); leitura: resposta de ler-fatura (ou null).
export function buildDraft({ qr, leitura, invoices = [], properties = [], rules = [], today }) {
  const r = leitura ? normalizeReading(leitura) : null
  const fonte = {}
  const avisos = []
  const pick = (key, fromQr, fromAi) => {
    if (fromQr !== null && fromQr !== undefined) { fonte[key] = 'qr'; return fromQr }
    if (fromAi !== null && fromAi !== undefined) { fonte[key] = 'ia'; return fromAi }
    return null
  }
  const nif = pick('nif', qr?.nif, r?.nif)
  const known = supplierFromHistory(nif, invoices)
  let fornecedor = null
  if (known) { fornecedor = known.fornecedor; fonte.fornecedor = 'historico' } else if (r?.fornecedor) { fornecedor = r.fornecedor; fonte.fornecedor = 'ia' }
  const data = pick('data', qr?.data, r?.data)
  const documento = pick('documento', qr?.documento, r?.documento)
  const valor = pick('valor', qr?.valor_total, r?.valor_total)
  const iva = pick('iva', qr?.iva, r?.iva)
  if (r?.descricao) fonte.descricao = 'ia'

  if (qr && r?.valor_total !== null && r?.valor_total !== undefined && cents(r.valor_total) !== cents(qr.valor_total)) {
    avisos.push(`A leitura da imagem deu ${formatAmount(r.valor_total)} €, mas o código QR diz ${formatAmount(qr.valor_total)} €. Ficou o valor do QR.`)
  }
  const notaCredito = qr?.tipo === 'NC' || (!qr && r?.tipo_documento === 'nota_credito')
  if (notaCredito) avisos.push('É uma nota de crédito (anulação): fica com valor negativo e abate às despesas.')
  if (qr?.anulado) avisos.push('O código QR diz que este documento foi anulado.')
  if (!qr && !r) avisos.push('Não foi possível ler este ficheiro. Preenche os campos à mão.')
  if (data && today && data > today) avisos.push('A data da fatura é no futuro. Confirma a data.')

  const fromClient = matchProperty(r?.cliente, properties)
  const imovel_id = fromClient ?? known?.imovel_id ?? properties[0]?.id ?? ''
  // Fatura-recibo e afins já vêm pagas: pergunta-se como (a leitura sugere, se o documento disser).
  const pagaNoAto = qr ? PAID_QR.has(qr.tipo) : PAID_AI.has(r?.tipo_documento)
  let pagamento = 'Por pagar'
  if (pagaNoAto) {
    pagamento = PAY_FROM_READING[r?.pagamento] || ''
    if (pagamento) fonte.pagamento = 'ia'
  } else if (r?.pagamento === 'numerario') avisos.push('A fatura diz que foi paga em numerário. Se já foi paga, muda o pagamento antes de gravar.')
  // Regra do fornecedor (Editar categorias): ex.: Grão de Trigo fica sempre por pagar até ao fim do mês.
  const rule = ruleFor(fornecedor, rules)
  if (rule?.pagamento && !pagaNoAto) { pagamento = rule.pagamento; fonte.pagamento = 'regra' }

  return {
    fornecedor: fornecedor || '',
    data: data || '',
    documento: documento || '',
    valor: formatAmount(valor != null && notaCredito ? -Math.abs(valor) : valor),
    iva: formatAmount(iva != null && notaCredito ? -Math.abs(iva) : iva),
    descricao: r?.descricao || '',
    imovel_id: imovel_id === null ? '' : String(imovel_id),
    // Fornecedor com categoria fixa (Editar categorias) ganha à última usada.
    categoria_id: rule?.categoria_id ?? known?.categoria_id ?? null,
    regraPagamento: (!pagaNoAto && rule?.pagamento) || null,
    pagamento,
    pagaNoAto,
    nif: nif || '',
    atcud: qr?.atcud || '',
    tipo: qr?.tipo_nome || AI_TIPO_NOME[r?.tipo_documento] || null,
    fonte,
    avisos,
  }
}

// Faturas já registadas que parecem ser esta. "certo": mesmo ATCUD, ou mesmo nº de documento
// do mesmo fornecedor (NIF ou nome) ou com o mesmo valor. "provavel": mesmo fornecedor, data e valor.
export function findInvoiceDuplicates(draft, invoices) {
  const out = []
  const doc = docKey(draft.documento)
  const atcud = String(draft.atcud || '').toUpperCase()
  const supplier = supplierKey(draft.fornecedor)
  const value = cents(parseMoney(draft.valor))
  for (const inv of invoices || []) {
    if (inv.estado === 'Rejeitada') continue
    const sameSupplier = (draft.nif && nifOf(inv) === draft.nif) || (supplier && supplierKey(inv.fornecedor) === supplier)
    const sameValue = value !== null && cents(inv.valor) === value
    let certeza = null
    if (atcud && atcudOf(inv) === atcud) certeza = 'certo'
    else if (doc.length >= 3 && docKey(inv.documento) === doc && (sameSupplier || sameValue)) certeza = 'certo'
    else if (sameSupplier && sameValue && draft.data && inv.data === draft.data) certeza = 'provavel'
    if (certeza) out.push({ certeza, invoice: inv })
  }
  return out.sort((a, b) => (a.certeza === 'certo' ? -1 : 1) - (b.certeza === 'certo' ? -1 : 1))
}

// Linha a gravar em invoices. Devolve { row } ou { error } com a mensagem para mostrar.
export function draftToInvoice(draft, { userId }) {
  const valor = String(draft.valor || '').trim() ? parseMoney(draft.valor) : null
  if (String(draft.valor || '').trim() && valor === null) return { error: 'O valor não é válido. Usa, por exemplo, 12,30' }
  const iva = String(draft.iva || '').trim() ? parseMoney(draft.iva) : null
  if (String(draft.iva || '').trim() && iva === null) return { error: 'O IVA não é válido. Usa, por exemplo, 2,30' }
  if (!draft.data) return { error: 'Falta a data da fatura.' }
  if (!['Por pagar', 'Numerário', 'CGD', 'Airbnb'].includes(draft.pagamento)) return { error: 'Escolhe como foi paga.' }
  const obs = [
    draft.nif && `NIF do fornecedor: ${draft.nif}`,
    draft.atcud && `ATCUD: ${draft.atcud}`,
    draft.debitoDireto && 'Paga por débito direto (CGD).',
    draft.emailDe
      ? `Recebida por email de ${draft.emailDe}${draft.fonte?.valor === 'qr' ? ' (valores do código QR)' : ''}.`
      : `Adicionada arrastando o ficheiro${draft.fonte?.valor === 'qr' ? ' (valores do código QR)' : ''}.`,
  ].filter(Boolean).join('\n')
  return {
    row: {
      fornecedor: draft.fornecedor.trim() || null,
      data: draft.data,
      documento: draft.documento.trim() || null,
      descricao: draft.descricao.trim() || null,
      imovel_id: draft.imovel_id ? Number(draft.imovel_id) : null,
      categoria_id: draft.categoria_id ?? null,
      pagamento: draft.pagamento,
      valor,
      iva,
      estado: 'Por validar',
      origem: 'manual',
      observacoes: obs,
      submitted_by: userId,
    },
  }
}
