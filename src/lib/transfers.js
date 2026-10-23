// Pesquisa nas transferências da receção: nome, notas, reserva, imóvel, data ou valor.
import { formatDate } from './dates.js'

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function matchesTransfer(t, query, propertiesById) {
  const q = fold(query).trim()
  if (!q) return true
  const valor = Number(t.valor)
  const amounts = Number.isFinite(valor) ? [valor.toFixed(2), valor.toFixed(2).replace('.', ','), String(valor)] : []
  const text = fold([t.ordenante, t.descricao, t.notas, t.reserva, propertiesById?.get(t.imovel_id), t.data, formatDate(t.data), ...amounts].join(' | '))
  return q.split(/\s+/).every(word => text.includes(word.replace(/€/g, '')))
}

export const isAllocated = t => Boolean(t.alocada_em)
