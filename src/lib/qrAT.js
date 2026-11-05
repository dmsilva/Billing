// Código QR das faturas portuguesas (Portaria 195/2020): "A:500000000*B:999999990*C:PT*D:FT*…".
// É gerado pelo programa de faturação certificado, por isso os números são mais fiáveis do que uma leitura da imagem.
// Lógica pura, usada no navegador e nos testes.

const DOC_TYPES = {
  FT: 'Fatura', FS: 'Fatura simplificada', FR: 'Fatura-recibo', NC: 'Nota de crédito', ND: 'Nota de débito',
  VD: 'Venda a dinheiro', TV: 'Talão de venda', RG: 'Recibo', RC: 'Recibo',
}

// Campos de IVA (base, imposto) por espaço fiscal: I = continente, J = Açores, K = Madeira.
const VAT_FIELDS = ['I4', 'I6', 'I8', 'J4', 'J6', 'J8', 'K4', 'K6', 'K8']

const amount = v => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null
}

const nif = v => (/^\d{9}$/.test(String(v || '')) ? String(v) : null)

function date(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v || ''))
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

// Devolve os campos do QR AT, ou null se o texto não for um QR de fatura.
export function parseQrAT(text) {
  const s = String(text || '').trim()
  if (!/^A:\d{9}\*B:/.test(s)) return null
  const f = {}
  for (const part of s.split('*')) {
    const i = part.indexOf(':')
    if (i > 0) f[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  const emitente = nif(f.A)
  const total = amount(f.O)
  if (!emitente || total === null) return null
  const vatParts = VAT_FIELDS.map(k => amount(f[k])).filter(v => v !== null)
  const iva = vatParts.length ? Math.round(vatParts.reduce((a, b) => a + b, 0) * 100) / 100 : amount(f.N)
  const tipo = String(f.D || '').toUpperCase()
  return {
    nif: emitente,
    nif_cliente: f.B && f.B !== '999999990' ? nif(f.B) : null,
    tipo,
    tipo_nome: DOC_TYPES[tipo] || tipo || null,
    anulado: String(f.E || '').toUpperCase() === 'A',
    data: date(f.F),
    documento: f.G ? f.G.replace(/\s+/g, ' ').slice(0, 60) : null,
    atcud: f.H && f.H !== '0' ? f.H.slice(0, 60) : null,
    valor_total: total,
    iva,
  }
}

// Entre vários QR lidos no mesmo ficheiro, fica o primeiro que for de uma fatura.
export function firstQrAT(texts) {
  for (const t of texts || []) {
    const q = parseQrAT(t)
    if (q) return q
  }
  return null
}
