// Importação da Caixa Diária (Excel/CSV).
//
// Formato principal (o Excel "Caixas Diárias 2026", uma folha por dia):
//   - a data do dia aparece numa das primeiras linhas;
//   - uma linha de cabeçalho com Hóspede, Quarto, Dinheiro, CV, MB, city mb, Funcionário;
//   - linhas "Fecho 7h", "Fecho 15h", "Fecho 23h" com os totais de cada turno;
//   - as linhas de hóspedes (com quarto) a seguir a um fecho contam como registos desse turno.
// Formato alternativo (tabela simples): Data | Turno | Dinheiro | CV | MB | City MB.
//
// Este módulo recebe matrizes (array de linhas) para poder ser testado sem o SheetJS.
import { parseMoney, sameAmount } from './money.js'
import { compareCloses } from './reconciliation.js'

const MONTHS_PT = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 }
const pad = n => String(n).padStart(2, '0')
const year4 = y => (String(y).length === 2 ? `20${y}` : String(y))

function validIso(y, m, d) {
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(m) - 1 || dt.getUTCDate() !== Number(d)) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function excelSerialToIso(serial) {
  if (typeof serial !== 'number' || serial < 20000 || serial > 80000) return null
  const ms = Math.round((serial - 25569) * 86400000)
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function parseDateCell(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // O SheetJS cria datas à meia-noite local; usar a data local evita recuar um dia.
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  if (typeof v === 'number') return excelSerialToIso(v)
  const t = String(v).trim().toLowerCase()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return validIso(m[1], m[2], m[3])
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) return validIso(year4(m[3]), m[2], m[1])
  m = t.match(/(\d{1,2})(?:\s+de\s+|[-/\s])([a-zà-ÿç]{3,})\.?(?:\s+de\s+|[-/\s])(\d{2,4})/)
  if (m) {
    const mon = MONTHS_PT[m[2].slice(0, 3)]
    if (mon) return validIso(year4(m[3]), mon, m[1])
  }
  return null
}

export function shiftOf(text) {
  const t = String(text ?? '').trim()
  const m = t.match(/^(?:fecho\s*)?(?:turno\s*)?0?(7|15|23)\s*h/i)
  return m ? `${m[1]}h` : null
}

const norm = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const money = v => parseMoney(v) ?? 0

const HEADER_KEYS = {
  hospede: ['hospede'],
  quarto: ['quarto'],
  dinheiro: ['dinheiro', 'numerario', 'cash'],
  cv: ['cv'],
  mb: ['mb', 'multibanco'],
  city_mb: ['city mb', 'citymb', 'city tax', 'citytax', 'city_mb'],
  funcionario: ['funcionario'],
  data: ['data', 'dia', 'date'],
  turno: ['turno', 'fecho', 'shift'],
}

function headerIndex(row) {
  const idx = {}
  row.forEach((cell, i) => {
    const n = norm(cell)
    for (const [key, names] of Object.entries(HEADER_KEYS)) if (idx[key] === undefined && names.includes(n)) idx[key] = i
  })
  return idx
}

// Folha de um dia no formato do Excel da Caixa Diária.
export function parseDaySheet(matrix, sheetName = '') {
  let date = null
  for (let r = 0; r < Math.min(matrix.length, 12) && !date; r++) {
    for (const v of matrix[r] || []) {
      date = parseDateCell(v)
      if (date) break
    }
  }
  if (!date) date = parseDateCell(sheetName)
  let headerRow = -1
  let idx = {}
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const h = headerIndex(matrix[r] || [])
    if (h.hospede !== undefined && h.quarto !== undefined && h.dinheiro !== undefined && h.cv !== undefined && h.mb !== undefined) {
      headerRow = r
      idx = h
      break
    }
  }
  if (!date || headerRow < 0) return []
  const out = []
  const guests = {}
  let current = null
  const firstCol = idx.hospede ?? 0
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || []
    const label = String(row[firstCol] ?? row[0] ?? '').trim()
    const shift = /fecho/i.test(label) ? shiftOf(label.replace(/^.*?fecho/i, 'fecho')) : null
    if (shift) {
      const get = k => (idx[k] !== undefined ? money(row[idx[k]]) : 0)
      out.push({ data: date, turno: shift, dinheiro: get('dinheiro'), cv: get('cv'), mb: get('mb'), city_mb: get('city_mb'), registos: 0 })
      current = shift
    } else if (current && label && !/^total/i.test(label) && String(row[idx.quarto] ?? '').trim()) {
      // Como no legado: as linhas de hóspedes a seguir a "Fecho Xh" pertencem a esse turno.
      guests[current] = (guests[current] || 0) + 1
    }
  }
  for (const r of out) r.registos = guests[r.turno] || 0
  return out
}

// Tabela simples: uma linha por fecho.
export function parseFlatTable(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const idx = headerIndex(matrix[r] || [])
    if (idx.data === undefined || idx.turno === undefined || idx.dinheiro === undefined) continue
    const out = []
    for (let i = r + 1; i < matrix.length; i++) {
      const row = matrix[i] || []
      const data = parseDateCell(row[idx.data])
      const turno = shiftOf(row[idx.turno])
      if (!data || !turno) continue
      const get = k => (idx[k] !== undefined ? money(row[idx[k]]) : 0)
      out.push({ data, turno, dinheiro: get('dinheiro'), cv: get('cv'), mb: get('mb'), city_mb: get('city_mb'), registos: null })
    }
    return out
  }
  return []
}

// sheets: [{ name, matrix }]
export function parseCashSheets(sheets) {
  const found = new Map()
  const warnings = []
  for (const { name, matrix } of sheets) {
    let rows = parseDaySheet(matrix, name)
    if (!rows.length) rows = parseFlatTable(matrix)
    if (!rows.length) { warnings.push(`Folha "${name}": não encontrei fechos 7h/15h/23h.`); continue }
    for (const r of rows) {
      const k = `${r.data}|${r.turno}`
      if (found.has(k)) warnings.push(`${r.data} ${r.turno} aparece mais do que uma vez; ficou o último valor (folha "${name}").`)
      found.set(k, r)
    }
  }
  return { records: [...found.values()].sort(compareCloses), warnings }
}

export function parseCsvText(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const sep = [';', '\t', ','].find(s => lines[0].includes(s)) || ';'
  return lines.map(line => splitCsvLine(line, sep))
}

function splitCsvLine(line, sep) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

const FIELDS = ['dinheiro', 'cv', 'mb', 'city_mb']

// Compara o ficheiro com o que já existe na base de dados, antes de gravar.
export function diffCashImport(existing, records) {
  const map = new Map(existing.map(c => [`${c.data}|${c.turno}`, c]))
  const novos = []
  const alterados = []
  const iguais = []
  for (const r of records) {
    const cur = map.get(`${r.data}|${r.turno}`)
    if (!cur) novos.push(r)
    else if (FIELDS.some(f => !sameAmount(cur[f], r[f]))) alterados.push({ antes: cur, depois: r, campos: FIELDS.filter(f => !sameAmount(cur[f], r[f])) })
    else iguais.push(r)
  }
  return { novos, alterados, iguais }
}
