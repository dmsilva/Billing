export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export const monthOf = d => String(d || '').slice(0, 7)

export function monthLabel(key) {
  if (!key) return 'Todos os meses'
  const m = Number(key.slice(5, 7))
  return `${MONTH_NAMES[m - 1] || key.slice(5, 7)} ${key.slice(0, 4)}`
}

export const monthShort = key => (MONTH_NAMES[Number(key.slice(5, 7)) - 1] || '').slice(0, 3)

export function formatDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return d ? `${d}/${m}/${y}` : iso
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
}

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

// Diferença em dias entre duas datas ISO.
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}
