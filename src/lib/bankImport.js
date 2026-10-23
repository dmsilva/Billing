// Importação do extrato CGD (Excel/CSV exportado do Caixadirecta).
// As saídas (débitos) são despesas; as entradas (créditos) ficam à parte, como recebimentos.
import { parseMoney } from './money.js'
import { parseDateCell } from './cashImport.js'

const norm = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

// Chave única de um movimento. É a mesma usada na migração dos dados legados,
// para que voltar a importar o extrato de julho não duplique movimentos.
export function bankHash({ data_mov, descricao, valor, saldo }) {
  const v = Number(valor).toFixed(2)
  const s = saldo == null || saldo === '' ? '' : Number(saldo).toFixed(2)
  return `${data_mov}|${String(descricao || '').trim().replace(/\s+/g, ' ').toUpperCase()}|${v}|${s}`
}

const COLS = {
  data_mov: ['data mov', 'data mov.', 'data movimento', 'data de movimento', 'data lancamento', 'data'],
  data_valor: ['data valor', 'data-valor', 'data de valor'],
  descricao: ['descricao', 'descritivo', 'movimento'],
  debito: ['debito', 'debitos', 'saida', 'saidas'],
  credito: ['credito', 'creditos', 'entrada', 'entradas'],
  montante: ['montante', 'valor', 'importancia'],
  saldo: ['saldo', 'saldo contabilistico', 'saldo disponivel'],
}

function findHeader(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const idx = {}
    ;(matrix[r] || []).forEach((cell, i) => {
      const n = norm(cell).replace(/\s*\(.*\)$/, '')
      for (const [k, names] of Object.entries(COLS)) if (idx[k] === undefined && names.includes(n)) idx[k] = i
    })
    if (idx.data_mov !== undefined && idx.descricao !== undefined && (idx.debito !== undefined || idx.montante !== undefined)) return { row: r, idx }
  }
  return null
}

export function parseBankStatement(matrix) {
  const h = findHeader(matrix)
  if (!h) return { records: [], credits: [], ignored: 0, error: 'Não encontrei as colunas Data, Descrição e Débito/Montante.' }
  const { idx } = h
  const records = []
  const credits = []
  let ignored = 0
  for (let r = h.row + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const data_mov = parseDateCell(row[idx.data_mov])
    const descricao = String(row[idx.descricao] ?? '').trim()
    if (!data_mov || !descricao) continue
    let out = null
    let inn = null
    if (idx.debito !== undefined) {
      const d = parseMoney(row[idx.debito])
      if (d) out = Math.abs(d)
      const c = idx.credito !== undefined ? parseMoney(row[idx.credito]) : null
      if (!out && c) inn = Math.abs(c)
    } else {
      const m = parseMoney(row[idx.montante])
      if (m != null && m < 0) out = Math.abs(m)
      else if (m) inn = m
    }
    if (!out && !inn) { ignored++; continue }
    const saldo = idx.saldo !== undefined ? parseMoney(row[idx.saldo]) : null
    const rec = { data_mov, data_valor: idx.data_valor !== undefined ? parseDateCell(row[idx.data_valor]) || data_mov : data_mov, descricao, valor: out || inn, saldo }
    if (out) records.push({ ...rec, import_hash: bankHash(rec) })
    else credits.push({ ...rec, import_hash: bankHash(rec), tipo: classifyCredit(descricao) })
  }
  return { records, credits, ignored, error: null }
}

// Origem de uma entrada, a partir do texto do banco.
export const CREDIT_TYPES = ['Expedia', 'Booking', 'Airbnb', 'Stripe', 'TPA / Multibanco', 'Transferência', 'Depósito', 'Outra']
const CREDIT_RULES = [
  ['Expedia', /EXPEDIA|TRAVEL ?SCAPE|HOTELS\.?COM|VRBO/],
  ['Booking', /BOOKING/],
  ['Airbnb', /AIRBNB/],
  ['Stripe', /STRIPE/],
  ['TPA / Multibanco', /POS VENDAS|\bTPA\b|\bSIBS\b/],
  ['Depósito', /^DEP(OSITO|\.|\s)|DEPOSITO/],
  ['Transferência', /\bTRF\b|\bTFI\b|TRANSF|SEPA|MB ?WAY|\bTRANS\b|INSTANT/],
]
export function classifyCredit(descricao) {
  const d = norm(descricao).toUpperCase()
  return CREDIT_RULES.find(([, re]) => re.test(d))?.[0] || 'Outra'
}

// Transferências de hóspedes vão por omissão para a lista da receção; pagamentos de plataformas não.
export const goesToReception = tipo => tipo === 'Transferência'

// Ordenante provável: o texto do banco sem os prefixos de transferência e sem referências numéricas.
export function guessPayer(descricao) {
  const s = String(descricao || '').toUpperCase().replace(/[+/:;,*#]/g, ' ')
    .replace(/\b(TRF|TRANSF\.?|TRANSFERENCIA|TRANSFERÊNCIA|CRED|CREDITO|CRÉDITO|SEPA\+?|INST|INSTANT|IMED|RECEBIDA|ORD|DE|MB ?WAY|MBWAY|P)\b/g, ' ')
    .replace(/\d{3,}/g, ' ').replace(/\s+/g, ' ').trim()
  return s || String(descricao || '').trim()
}

// Transferência registada à mão que provavelmente corresponde a esta entrada (mesmo valor, até 10 dias antes ou 3 depois).
export function matchTransfer(credit, transfers, taken = new Set()) {
  const day = d => Date.parse(`${d}T00:00:00Z`) / 86400000
  return transfers
    .filter(t => !t.bank_credit_id && !taken.has(t.id) && Math.round(Number(t.valor) * 100) === Math.round(Number(credit.valor) * 100))
    .map(t => ({ t, diff: day(credit.data_mov) - day(t.data) }))
    .filter(x => x.diff >= -3 && x.diff <= 10)
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0]?.t || null
}

// Descrição sem números de referência, para reconhecer o mesmo fornecedor noutro mês.
export const descriptionStem = d => String(d || '').toUpperCase().replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim()

// Sugere categoria e imóvel a partir do movimento anterior mais recente com a mesma descrição.
export function suggestClassification(record, previous) {
  const stem = descriptionStem(record.descricao)
  const match = [...previous]
    .filter(t => descriptionStem(t.descricao) === stem)
    .sort((a, b) => String(b.data_mov).localeCompare(String(a.data_mov)))[0]
  return match ? { categoria_id: match.categoria_id, imovel_id: match.imovel_id } : { categoria_id: null, imovel_id: null }
}
