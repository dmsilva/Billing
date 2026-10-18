// Importação do extrato CGD (Excel/CSV exportado do Caixadirecta).
// Só as saídas (débitos) são despesas; as entradas bancárias são ignoradas.
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
  if (!h) return { records: [], ignored: 0, error: 'Não encontrei as colunas Data, Descrição e Débito/Montante.' }
  const { idx } = h
  const records = []
  let ignored = 0
  for (let r = h.row + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const data_mov = parseDateCell(row[idx.data_mov])
    const descricao = String(row[idx.descricao] ?? '').trim()
    if (!data_mov || !descricao) continue
    let out = null
    if (idx.debito !== undefined) {
      const d = parseMoney(row[idx.debito])
      if (d) out = Math.abs(d)
    } else {
      const m = parseMoney(row[idx.montante])
      if (m != null && m < 0) out = Math.abs(m)
    }
    if (!out) { ignored++; continue }
    const saldo = idx.saldo !== undefined ? parseMoney(row[idx.saldo]) : null
    const rec = { data_mov, data_valor: idx.data_valor !== undefined ? parseDateCell(row[idx.data_valor]) || data_mov : data_mov, descricao, valor: out, saldo }
    records.push({ ...rec, import_hash: bankHash(rec) })
  }
  return { records, ignored, error: null }
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
