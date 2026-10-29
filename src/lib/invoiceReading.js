// Leitura automática de faturas: esquema pedido ao modelo e conversão do resultado
// em campos do formulário da Receção. Lógica pura, usada no navegador e na função do Netlify.

// Categorias largas dos artigos (o "artigo" é o produto em si: Manteiga, Leite…).
export const PRODUCT_TYPES = ['Pequeno-almoço', 'Laticínios', 'Fruta', 'Fruta/legumes', 'Bebidas', 'Mercearia', 'Limpeza', 'Consumíveis', 'Alimentação', 'Outros']
export const MAX_LINES = 200

export const READING_SCHEMA = {
  type: 'object',
  properties: {
    fornecedor: { type: ['string', 'null'], description: 'Nome comercial do emitente da fatura' },
    nif: { type: ['string', 'null'], description: 'NIF do emitente, só dígitos' },
    data: { type: ['string', 'null'], description: 'Data de emissão no formato AAAA-MM-DD' },
    documento: { type: ['string', 'null'], description: 'Número do documento, por exemplo FT 2026/1234' },
    valor_total: { type: ['number', 'null'], description: 'Total a pagar com IVA, em euros' },
    iva: { type: ['number', 'null'], description: 'Total de IVA, em euros' },
    pagamento: { type: 'string', enum: ['numerario', 'cartao', 'transferencia', 'desconhecido'], description: 'Como foi pago, se o documento o indicar' },
    cliente: { type: ['string', 'null'], description: 'Nome e morada do cliente (adquirente) tal como aparecem no documento' },
    descricao: { type: ['string', 'null'], description: 'Resumo curto, em português, do que foi comprado (máx. 80 caracteres)' },
    linhas: {
      type: 'array',
      description: 'Uma entrada por artigo comprado, pela ordem do documento',
      items: {
        type: 'object',
        properties: {
          produto: { type: 'string', description: 'Descrição do artigo tal como está no documento' },
          artigo: { type: 'string', description: 'Nome genérico do produto, sem marca nem tamanho (ex.: Manteiga, Leite, Detergente da loiça)' },
          tipo: { type: 'string', enum: PRODUCT_TYPES },
          quantidade: { type: ['number', 'null'] },
          unidade: { type: ['string', 'null'], description: 'un, kg, L, cx…' },
          valor: { type: ['number', 'null'], description: 'Total da linha em euros, com IVA e já com o desconto da linha' },
        },
        required: ['produto', 'artigo', 'tipo', 'quantidade', 'unidade', 'valor'],
        additionalProperties: false,
      },
    },
  },
  required: ['fornecedor', 'nif', 'data', 'documento', 'valor_total', 'iva', 'pagamento', 'cliente', 'descricao', 'linhas'],
  additionalProperties: false,
}

export const READING_PROMPT = `Estas imagens ou PDF são uma fatura, fatura-recibo, recibo ou talão português.
Extrai os dados do documento. Usa null para tudo o que não consigas ler com segurança; nunca adivinhes.
- fornecedor: o emitente (quem vende), não o cliente.
- nif: o NIF do emitente, não o do cliente.
- data: a data de emissão, em AAAA-MM-DD.
- valor_total: o total final pago, com IVA incluído.
- iva: o total de IVA do documento.
- pagamento: numerario se diz numerário/dinheiro; cartao se diz multibanco, MB, cartão, Visa, TPA; transferencia se diz transferência/MB Way/débito direto; senão desconhecido.
- cliente: o nome e a morada do cliente/adquirente, se existirem.
- descricao: um resumo curto do que foi comprado, por exemplo "Produtos de limpeza e pão".
- linhas: todos os artigos comprados, um por linha do documento.
  - produto: a descrição como aparece (ex.: "MANTEIGA MIMOSA C/SAL 250G").
  - artigo: o produto em si, curto, no singular, sem marca, peso nem embalagem (ex.: "Manteiga", "Leite", "Iogurte", "Detergente da loiça", "Papel higiénico"). O mesmo produto tem sempre o mesmo artigo, seja qual for a marca ou o fornecedor.
  - tipo: a categoria larga do artigo.
  - quantidade e unidade: como no documento (ex.: 6 un, 1,25 kg).
  - valor: o total da linha com IVA incluído, depois do desconto dessa linha. Se o documento mostra preços sem IVA, junta o IVA da taxa dessa linha.
  - Descontos gerais, vales ou cartão de cliente que não sejam de um artigo: uma linha com artigo "Desconto", tipo Outros e valor negativo. Portes de envio: artigo "Transporte".
  - Não incluas linhas de totais, subtotais, resumo de IVA nem pagamentos.`

// Junta à instrução os artigos já usados, para a leitura escrever os nomes sempre da mesma forma.
export function readingPrompt(artigos = []) {
  const known = [...new Set((artigos || []).map(a => cleanText(a, 40)).filter(Boolean))].slice(0, 300)
  return known.length ? `${READING_PROMPT}\n\nArtigos já usados (escreve o artigo exatamente assim quando for o mesmo produto): ${known.join('; ')}` : READING_PROMPT
}

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

function cleanSigned(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || Math.abs(n) > 1e6) return null
  return Math.round(n * 100) / 100
}

function cleanQuantity(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 1e6) return null
  return Math.round(n * 1000) / 1000
}

const capitalize = s => (s ? s.charAt(0).toLocaleUpperCase('pt') + s.slice(1) : s)

// Linhas de artigos: só as que têm descrição; o artigo cai para a descrição se vier vazio.
export function normalizeLines(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_LINES).map(l => {
    const produto = cleanText(l?.produto)
    if (!produto) return null
    return {
      produto,
      artigo: capitalize(cleanText(l.artigo, 40) || produto.slice(0, 40)),
      tipo: PRODUCT_TYPES.includes(l.tipo) ? l.tipo : 'Outros',
      quantidade: cleanQuantity(l.quantidade),
      unidade: cleanText(l.unidade, 15),
      valor: cleanSigned(l.valor),
    }
  }).filter(Boolean)
}

// Linhas a gravar em invoice_lines para uma fatura.
export function linesToRows(linhas, invoice) {
  return normalizeLines(linhas).map(l => ({
    ...l, invoice_id: invoice.id, fornecedor: invoice.fornecedor || null, data: invoice.data || null, lido_auto: true,
  }))
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
    pagamento: ['numerario', 'cartao', 'transferencia'].includes(r.pagamento) ? r.pagamento : null,
    cliente: cleanText(r.cliente, 200),
    descricao: cleanText(r.descricao, 120),
    linhas: normalizeLines(r.linhas),
  }
}

const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const GENERIC = new Set(['chalet', 'casa', 'hotel', 'alojamento', 'do', 'da', 'de', 'dos', 'das', 'd'])

// Imóvel cujo nome aparece no cliente da fatura (ex.: "Chalet do Lago"); só se for inequívoco.
export function matchProperty(cliente, properties) {
  const text = fold(cliente)
  if (!text) return null
  const hits = (properties || []).filter(p => {
    const words = fold(p.nome).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !GENERIC.has(w))
    return words.length && words.every(w => new RegExp(`\\b${w}\\b`).test(text))
  })
  return hits.length === 1 ? hits[0].id : null
}

const formatAmount = n => n.toFixed(2).replace('.', ',')

// Preenche apenas os campos que a pessoa ainda não escreveu.
// O meio de pagamento e o imóvel têm sempre um valor; só mudam se a pessoa ainda não lhes mexeu (touched).
export function applyReading(form, reading, today, { properties = [], touched = {} } = {}) {
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
  fill('descricao', r.descricao)
  if (r.pagamento && !touched.pagamento) {
    const pagamento = r.pagamento === 'numerario' ? 'Numerário' : 'CGD'
    if (pagamento !== form.pagamento) { next.pagamento = pagamento; filled.push('pagamento') }
  }
  const imovel = matchProperty(r.cliente, properties)
  if (imovel !== null && !touched.imovel_id && String(imovel) !== String(form.imovel_id)) {
    next.imovel_id = imovel
    filled.push('imovel_id')
  }
  if (r.iva !== null && (form.iva === undefined || form.iva === null || form.iva === '')) {
    next.iva = formatAmount(r.iva)
    filled.push('iva')
  }
  return { form: next, filled }
}
