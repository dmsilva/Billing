// Leitura automática de faturas: esquema pedido ao modelo e conversão do resultado
// em campos do formulário da Receção. Lógica pura, usada no navegador e na função do Netlify.

export const READING_SCHEMA = {
  type: 'object',
  properties: {
    fornecedor: { type: ['string', 'null'], description: 'Nome comercial do emitente da fatura' },
    nif: { type: ['string', 'null'], description: 'NIF do emitente, só dígitos' },
    data: { type: ['string', 'null'], description: 'Data de emissão no formato AAAA-MM-DD' },
    documento: { type: ['string', 'null'], description: 'Número do documento, por exemplo FT 2026/1234' },
    valor_total: { type: ['number', 'null'], description: 'Total a pagar com IVA, em euros' },
    iva: { type: ['number', 'null'], description: 'Total de IVA, em euros' },
  },
  required: ['fornecedor', 'nif', 'data', 'documento', 'valor_total', 'iva'],
  additionalProperties: false,
}

export const READING_PROMPT = `Estas imagens ou PDF são uma fatura, fatura-recibo, recibo ou talão português.
Extrai os dados do documento. Usa null para tudo o que não consigas ler com segurança; nunca adivinhes.
- fornecedor: o emitente (quem vende), não o cliente.
- nif: o NIF do emitente, não o do cliente.
- data: a data de emissão, em AAAA-MM-DD.
- valor_total: o total final pago, com IVA incluído.
- iva: o total de IVA do documento.`

// Tipos aceites por extensão, para ficheiros que o telemóvel envia sem tipo.
const BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' }

export function fileType(f) {
  if (f?.type) return f.type
  const ext = String(f?.name || '').toLowerCase().split('.').pop()
  return BY_EXTENSION[ext] || ''
}

const cleanText = (v, max = 120) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : null
}

function cleanDate(v) {
  const s = cleanText(v, 10)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

function cleanAmount(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 1e7) return null
  return Math.round(n * 100) / 100
}

function cleanNif(v) {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length === 9 ? digits : null
}

// Normaliza o que o modelo devolveu: só passam valores com formato válido.
export function normalizeReading(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    fornecedor: cleanText(r.fornecedor),
    nif: cleanNif(r.nif),
    data: cleanDate(r.data),
    documento: cleanText(r.documento, 60),
    valor_total: cleanAmount(r.valor_total),
    iva: cleanAmount(r.iva),
  }
}

const formatAmount = n => n.toFixed(2).replace('.', ',')

// Preenche apenas os campos que a pessoa ainda não escreveu.
export function applyReading(form, reading, today) {
  const r = normalizeReading(reading)
  const next = { ...form }
  const filled = []
  const fill = (key, value) => {
    if (value === null) return
    const current = String(form[key] ?? '').trim()
    if (current && !(key === 'data' && current === today)) return
    next[key] = value
    filled.push(key)
  }
  fill('fornecedor', r.fornecedor)
  fill('data', r.data)
  fill('documento', r.documento)
  fill('valor', r.valor_total === null ? null : formatAmount(r.valor_total))
  if (r.nif && !String(form.observacoes || '').includes(r.nif)) {
    next.observacoes = [String(form.observacoes || '').trim(), `NIF do fornecedor: ${r.nif}`].filter(Boolean).join('\n')
    filled.push('nif')
  }
  if (r.iva !== null && (form.iva === undefined || form.iva === null || form.iva === '')) {
    next.iva = formatAmount(r.iva)
    filled.push('iva')
  }
  return { form: next, filled }
}
