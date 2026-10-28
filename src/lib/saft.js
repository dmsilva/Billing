// Leitura do ficheiro SAF-T (PT) exportado do programa de faturação.
// Funciona no navegador e nos testes (sem DOM): o SAF-T tem uma estrutura fixa e simples,
// por isso basta extrair as etiquetas de que precisamos.
import { sum, sumBy } from './money.js'

// ---------- Ficheiro (.xml ou .zip) ----------

// Lê o primeiro .xml dentro de um .zip (método "stored" ou "deflate").
async function unzipFirstXml(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 0
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const flags = view.getUint16(p + 6, true)
    const method = view.getUint16(p + 8, true)
    let size = view.getUint32(p + 18, true)
    const nameLen = view.getUint16(p + 26, true)
    const extraLen = view.getUint16(p + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen))
    const start = p + 30 + nameLen + extraLen
    if (flags & 0x08 && size === 0) {
      // Tamanho só no diretório central: procurar a assinatura do descritor de dados.
      let q = start
      while (q + 4 <= bytes.length && view.getUint32(q, true) !== 0x08074b50) q++
      size = q - start
    }
    const data = bytes.subarray(start, start + size)
    if (/\.xml$/i.test(name)) {
      if (method === 0) return data
      if (method !== 8) throw new Error('Este .zip usa um método de compressão desconhecido.')
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    p = start + size + (flags & 0x08 ? 16 : 0)
  }
  throw new Error('O .zip não tem nenhum ficheiro .xml.')
}

// Bytes do ficheiro → texto XML, respeitando a codificação declarada (normalmente Windows-1252).
export async function saftText(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0x50 && b[1] === 0x4b) b = await unzipFirstXml(b)
  const head = new TextDecoder('latin1').decode(b.subarray(0, 200))
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() || 'utf-8'
  return new TextDecoder(enc === 'utf8' ? 'utf-8' : enc).decode(b)
}

// ---------- XML ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m))

// Os ficheiros podem usar prefixo de namespace (<ns0:Invoice>); aceitamos com ou sem.
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))].map(m => m[1])
const block = (xml, tag) => blocks(xml, tag)[0] ?? ''
const text = (xml, tag) => {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${tag}>`).exec(xml)
  return m ? decode(m[1]).trim() : ''
}
const num = (xml, tag) => Number(text(xml, tag) || 0)

// ---------- Regras ----------

export const CITY_TAX_RE = /city\s*tax|touristic\s*tax|tourist\s*tax|taxa\s*tur[ií]stica|taxa\s*municipal\s*tur/i
const CHANNELS = [['Airbnb', /airbnb/i], ['Expedia', /expedia|travelscape|hotels\.com/i], ['Booking', /booking/i], ['Hostelworld', /hostelworld/i], ['Grupo', /\bgrupo\b|\bgroup\b/i]]

export const detectChannel = textToSearch => CHANNELS.find(([, re]) => re.test(textToSearch))?.[0] || null
// Faturas, faturas simplificadas e faturas-recibo somam; notas de crédito subtraem.
export const SALES_TYPES = new Set(['FT', 'FS', 'FR', 'ND'])
export const docSign = d => (d.tipo === 'NC' ? -1 : 1)
export const docCounts = d => d.estado !== 'A'
// Faturas que precisam de recibo (a fatura-recibo e a simplificada já são pagas na emissão).
export const needsReceipt = d => d.tipo === 'FT' || d.tipo === 'ND'

export const MEIOS = { NU: 'Numerário', CC: 'Cartão de crédito', CD: 'Cartão de débito', MB: 'Multibanco', TB: 'Transferência', CH: 'Cheque', OU: 'Outro', PR: 'Permuta', CI: 'Crédito documentário', CO: 'Cheque/cartão oferta', CS: 'Compensação', DE: 'Dinheiro eletrónico', LC: 'Letra comercial', TR: 'Vales' }

// ---------- Leitura ----------

export function parseSaft(xml) {
  if (!/<(?:\w+:)?AuditFile[\s>]/.test(xml)) throw new Error('Este ficheiro não parece um SAF-T (falta AuditFile).')
  const header = block(xml, 'Header')
  const info = {
    nif: text(header, 'TaxRegistrationNumber') || text(header, 'CompanyID'),
    empresa: text(header, 'CompanyName'),
    inicio: text(header, 'StartDate'),
    fim: text(header, 'EndDate'),
    software: text(header, 'ProductID'),
    criado: text(header, 'DateCreated'),
  }
  if (!info.inicio || !info.fim) throw new Error('O SAF-T não indica o período (StartDate/EndDate).')

  const clientes = new Map()
  for (const c of blocks(block(xml, 'MasterFiles'), 'Customer')) {
    clientes.set(text(c, 'CustomerID'), { nome: text(c, 'CompanyName'), nif: text(c, 'CustomerTaxID'), email: text(c, 'Email') })
  }

  const docs = blocks(block(xml, 'SalesInvoices'), 'Invoice').map(inv => {
    const cliente = clientes.get(text(inv, 'CustomerID')) || { nome: '', nif: '', email: '' }
    const linhas = blocks(inv, 'Line').map(l => {
      const valor = num(l, 'CreditAmount') || num(l, 'DebitAmount')
      const taxa = num(l, 'TaxPercentage')
      return { codigo: text(l, 'ProductCode'), descricao: text(l, 'ProductDescription') || text(l, 'Description'), valor, taxa, referencia: text(l, 'Reference') }
    })
    const cityLines = linhas.filter(l => CITY_TAX_RE.test(`${l.codigo} ${l.descricao}`))
    const totals = block(inv, 'DocumentTotals')
    return {
      numero: text(inv, 'InvoiceNo'),
      tipo: text(inv, 'InvoiceType'),
      estado: text(block(inv, 'DocumentStatus'), 'InvoiceStatus') || 'N',
      data: text(inv, 'InvoiceDate'),
      cliente: cliente.nome,
      nif_cliente: cliente.nif,
      liquido: num(totals, 'NetTotal'),
      iva: num(totals, 'TaxPayable'),
      total: num(totals, 'GrossTotal'),
      city_tax: sum(cityLines.map(l => l.valor * (1 + l.taxa / 100))),
      // O email do hóspede costuma ser o da plataforma (…@m.expediapartnercentral.com, …@guest.airbnb.com).
      canal: detectChannel([cliente.nome, cliente.email, ...linhas.map(l => l.descricao)].join(' ')),
      referencias: [...new Set(linhas.map(l => l.referencia).filter(Boolean))],
      recibos: [],
      valor_recebido: 0,
      meios: [],
    }
  })

  const recibos = blocks(block(xml, 'Payments'), 'Payment').map(p => ({
    numero: text(p, 'PaymentRefNo'),
    estado: text(block(p, 'DocumentStatus'), 'PaymentStatus') || 'N',
    data: text(p, 'TransactionDate'),
    meios: blocks(p, 'PaymentMethod').map(m => ({ meio: text(m, 'PaymentMechanism'), valor: num(m, 'PaymentAmount'), data: text(m, 'PaymentDate') })),
    total: num(block(p, 'DocumentTotals'), 'GrossTotal'),
    linhas: blocks(p, 'Line').map(l => ({ documento: text(block(l, 'SourceDocumentID'), 'OriginatingON'), valor: num(l, 'CreditAmount') || num(l, 'DebitAmount') })),
  }))

  // Liga cada recibo válido aos documentos que paga. Um recibo que paga vários documentos
  // reparte-se pelo valor de cada linha (sem IVA) na proporção do total do recibo.
  const byNumero = new Map(docs.map(d => [d.numero, d]))
  const recibosFora = []
  for (const r of recibos.filter(x => x.estado !== 'A')) {
    const base = sumBy(r.linhas, l => l.valor)
    const meio = r.meios[0]?.meio || ''
    for (const l of r.linhas) {
      const valor = base ? Math.round((r.total * l.valor / base) * 100) / 100 : r.total
      const d = byNumero.get(l.documento)
      if (!d) { recibosFora.push({ numero: l.documento, recibo: r.numero, valor, meio }); continue }
      if (!d.recibos.includes(r.numero)) d.recibos.push(r.numero)
      d.valor_recebido = sum([d.valor_recebido, valor])
      for (const m of r.meios) if (m.meio && !d.meios.includes(m.meio)) d.meios.push(m.meio)
    }
  }

  const validos = docs.filter(docCounts)
  return {
    info: { ...info, total: sum(validos.map(d => docSign(d) * d.total)), recibos: recibos.length },
    docs,
    recibos,
    recibosFora,
    orcamentos: blocks(block(xml, 'WorkingDocuments'), 'WorkDocument').length,
  }
}

export async function readSaftFile(file) {
  const parsed = parseSaft(await saftText(new Uint8Array(await file.arrayBuffer())))
  return { ...parsed, info: { ...parsed.info, ficheiro: file.name } }
}
