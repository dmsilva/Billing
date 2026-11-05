// Gasto por artigo (manteiga, leite, detergente…) num período, a partir das linhas das faturas.
import { LEGACY_ITEMS_MONTH } from './finance.js'
import { sum, sumBy } from './money.js'

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Data da linha: a dela ou a da fatura. Os produtos do legado não têm data (ver LEGACY_ITEMS_MONTH).
export function lineDate(line, invoicesById) {
  return line.data || invoicesById?.get(line.invoice_id)?.data || null
}

// Linhas dentro do período [de, até] (datas AAAA-MM-DD, qualquer uma pode faltar).
// Ficam de fora as linhas de faturas rejeitadas.
export function linesInPeriod(lines, invoicesById, { de = '', ate = '' } = {}) {
  return lines.filter(l => {
    const inv = l.invoice_id != null ? invoicesById?.get(l.invoice_id) : null
    if (inv?.estado === 'Rejeitada') return false
    const d = lineDate(l, invoicesById)
    if (d) return (!de || d >= de) && (!ate || d <= ate)
    if (l.legacy_idx == null) return !de && !ate
    return (!de || de.slice(0, 7) <= LEGACY_ITEMS_MONTH) && (!ate || ate.slice(0, 7) >= LEGACY_ITEMS_MONTH)
  })
}

// Nome do artigo da linha; as linhas antigas (sem artigo) usam o nome do produto.
export const lineArtigo = l => (l.artigo || '').trim() || (l.produto || '').trim() || 'Sem nome'

const UNITS = { un: 'un', und: 'un', unid: 'un', uni: 'un', unidade: 'un', unidades: 'un', uds: 'un', ud: 'un', pc: 'un', pcs: 'un', kg: 'kg', kgs: 'kg', g: 'g', gr: 'g', l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L', ml: 'ml', cx: 'cx', caixa: 'cx', caixas: 'cx', emb: 'emb', pack: 'emb' }
export const normalizeUnit = u => {
  const k = fold(u).replace(/\.$/, '')
  return k ? UNITS[k] || k : 'un'
}

// Agrupa por artigo (sem distinguir maiúsculas nem acentos): gasto, quantidades por unidade,
// nº de compras, fornecedores e categoria mais frequente.
export function byArtigo(lines) {
  const map = new Map()
  for (const l of lines) {
    const nome = lineArtigo(l)
    const key = fold(nome)
    if (!map.has(key)) map.set(key, { artigo: nome, linhas: [], valores: [], qtd: new Map(), fornecedores: new Set(), tipos: new Map(), semValor: 0 })
    const g = map.get(key)
    g.linhas.push(l)
    if (l.valor != null) g.valores.push(l.valor)
    else g.semValor++
    if (l.quantidade != null) {
      const u = normalizeUnit(l.unidade)
      g.qtd.set(u, [...(g.qtd.get(u) || []), l.quantidade])
    }
    if (l.fornecedor) g.fornecedores.add(l.fornecedor.trim())
    const t = l.tipo || 'Outros'
    g.tipos.set(t, (g.tipos.get(t) || 0) + 1)
  }
  return [...map.values()].map(g => ({
    artigo: g.artigo,
    tipo: [...g.tipos].sort((a, b) => b[1] - a[1])[0][0],
    total: sum(g.valores),
    compras: g.linhas.length,
    semValor: g.semValor,
    quantidades: [...g.qtd].map(([unidade, qs]) => ({ unidade, quantidade: Math.round(qs.reduce((a, b) => a + Number(b), 0) * 1000) / 1000 })),
    fornecedores: [...g.fornecedores].sort((a, b) => a.localeCompare(b, 'pt')),
    linhas: g.linhas,
  })).sort((a, b) => b.total - a.total || a.artigo.localeCompare(b.artigo, 'pt'))
}

export const totalOf = lines => sumBy(lines.filter(l => l.valor != null), l => l.valor)

// Faturas com ficheiros cujos artigos ainda não foram lidos.
export function invoicesToRead(invoices, lines) {
  const withLines = new Set(lines.map(l => l.invoice_id).filter(id => id != null))
  return invoices.filter(i => i.estado !== 'Rejeitada' && (i.invoice_files || []).length > 0 && !i.artigos_lidos_em && !withLines.has(i.id))
}

// Períodos rápidos para o filtro (datas AAAA-MM-DD).
export function periodPresets(today) {
  const [y, m] = today.split('-').map(Number)
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1]
  const back2 = new Date(Date.UTC(y, m - 3, 1))
  return [
    { key: 'mes', label: 'Este mês', de: iso(y, m, 1), ate: iso(y, m, lastDay(y, m)) },
    { key: 'mes-passado', label: 'Mês passado', de: iso(prev[0], prev[1], 1), ate: iso(prev[0], prev[1], lastDay(prev[0], prev[1])) },
    { key: '3-meses', label: 'Últimos 3 meses', de: iso(back2.getUTCFullYear(), back2.getUTCMonth() + 1, 1), ate: iso(y, m, lastDay(y, m)) },
    { key: 'ano', label: 'Este ano', de: iso(y, 1, 1), ate: iso(y, 12, 31) },
    { key: 'ano-passado', label: 'Ano passado', de: iso(y - 1, 1, 1), ate: iso(y - 1, 12, 31) },
    { key: 'tudo', label: 'Tudo', de: '', ate: '' },
  ]
}
