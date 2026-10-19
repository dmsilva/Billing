// Valores monetários: leitura de formatos portugueses e somas sem erros de vírgula flutuante.
// Internamente somamos em milésimos de euro, porque alguns fechos do Excel têm 3 casas decimais.

const SCALE = 1000

export function toMilli(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * SCALE) : 0
}

export function fromMilli(m) {
  return m / SCALE
}

export function sum(values) {
  let acc = 0
  for (const v of values) acc += toMilli(v)
  return fromMilli(acc)
}

export function sumBy(rows, fn) {
  let acc = 0
  for (const r of rows) acc += toMilli(fn(r))
  return fromMilli(acc)
}

export function sub(a, b) {
  return fromMilli(toMilli(a) - toMilli(b))
}

// Duas quantias são iguais se coincidirem ao cêntimo (meio cêntimo de tolerância).
export function sameAmount(a, b) {
  return Math.abs(toMilli(a) - toMilli(b)) < 5
}

// Lê "1.234,56", "1234,56", "1,234.56", "1234.56", "€ 12,30", "-5,00", números e vazio.
// Devolve null quando o texto não é um valor válido.
export function parseMoney(input) {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = String(input).trim().replace(/\s| |€|EUR/gi, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1) }
  else if (s.startsWith('+')) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized
  if (lastComma >= 0 && lastDot >= 0) {
    // O último separador é o decimal; os outros são de milhares.
    const dec = lastComma > lastDot ? ',' : '.'
    const thousands = dec === ',' ? '.' : ','
    normalized = s.split(thousands).join('').replace(dec, '.')
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    normalized = parts.length > 2 ? parts.join('') : parts.join('.')
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    // "1.234.567" ou "1.234" com 3 dígitos após o ponto = milhares (convenção portuguesa).
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')
    normalized = isThousands ? parts.join('') : s
  } else normalized = s
  if ((normalized.match(/\./g) || []).length > 1) return null
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const euroFmt = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })
const euroFmt3 = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3 })

export function euro(n) {
  return euroFmt.format(Number(n || 0))
}

// Mostra a 3.ª casa decimal só quando existe (ex.: 165,642 €).
export function euroExact(n) {
  return euroFmt3.format(Number(n || 0))
}

export function numberPt(n, digits = 2) {
  return Number(n || 0).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}
