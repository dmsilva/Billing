// Conferência de caixa: para cada fecho (por ordem cronológica 7h → 15h → 23h),
// confirmar CV → MB → Numerário e só depois passar ao envelope seguinte.
import { parseMoney, sameAmount, sub, sum } from './money.js'

export const SHIFTS = ['7h', '15h', '23h']
export const CHECK_TYPES = ['cv', 'mb', 'dinheiro']

export const SHIFT_INFO = {
  '7h': { nome: 'Noite', horas: '23:00–07:00' },
  '15h': { nome: 'Manhã', horas: '07:00–15:00' },
  '23h': { nome: 'Tarde', horas: '15:00–23:00' },
}

export const checkLabel = t => (t === 'cv' ? 'CV' : t === 'mb' ? 'MB' : 'Numerário')
export const checkIcon = t => (t === 'dinheiro' ? '💶' : '💳')
export const nextLabel = t => (t === 'cv' ? 'MB' : t === 'mb' ? 'Numerário' : 'próximo envelope')

export function compareCloses(a, b) {
  return a.data === b.data ? SHIFTS.indexOf(a.turno) - SHIFTS.indexOf(b.turno) : a.data < b.data ? -1 : 1
}

export function expectedValue(close, type) {
  return Number(close?.[type] ?? 0)
}

export function checkStatus(check) {
  if (!check || check.valor_real == null) return 'pending'
  return sameAmount(check.valor_real, check.valor_esperado) ? 'ok' : 'bad'
}

export function checkDifference(check) {
  if (!check || check.valor_real == null) return null
  return sub(check.valor_real, check.valor_esperado)
}

export function buildQueue(closes, checks) {
  const map = new Map(checks.map(c => [`${c.cash_close_id}|${c.tipo}`, c]))
  const items = []
  for (const close of [...closes].sort(compareCloses)) {
    for (const type of CHECK_TYPES) {
      items.push({ close, type, expected: expectedValue(close, type), check: map.get(`${close.id}|${type}`) || null })
    }
  }
  return items
}

// Índice do próximo item por conferir (ou -1 se já está tudo conferido).
export const nextPendingIndex = items => items.findIndex(i => !i.check)

export function progress(items) {
  const done = items.filter(i => i.check).length
  return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 }
}

// Converte o que a utilizadora escreveu no valor real.
// Vazio (OK / Enter) = bate certo com o esperado.
export function resolveActual(raw, expected) {
  const s = String(raw ?? '').trim()
  if (s === '') return { ok: true, value: Number(expected) }
  const v = parseMoney(s)
  if (v === null || v < 0) return { ok: false, error: 'Valor inválido. Usa, por exemplo, 123,45' }
  return { ok: true, value: v }
}

// O fecho pode ter sido alterado (nova importação) depois da conferência.
export function expectedChanged(item) {
  return !!item.check && !sameAmount(item.check.valor_esperado, item.expected)
}

export function differencesSummary(items) {
  const bad = items.filter(i => checkStatus(i.check) === 'bad')
  let falta = 0
  let sobra = 0
  for (const i of bad) {
    const d = checkDifference(i.check)
    if (d < 0) falta = sum([falta, -d])
    else sobra = sum([sobra, d])
  }
  return { count: bad.length, falta, sobra, items: bad }
}
