// Mapa de IVA a partir dos documentos do SAF-T: base tributável e IVA por taxa.
// Regras: os documentos anulados não contam; as notas de crédito subtraem.
import { docCounts, docSign } from './saft.js'
import { sub, sum } from './money.js'
import { monthOf } from './dates.js'

export const ISENCOES = {
  M01: 'Artigo 16.º, n.º 6 do CIVA',
  M02: 'Artigo 6.º do DL 198/90',
  M04: 'Isento artigo 13.º do CIVA',
  M05: 'Isento artigo 14.º do CIVA',
  M06: 'Isento artigo 15.º do CIVA',
  M07: 'Isento artigo 9.º do CIVA',
  M10: 'Regime de isenção (artigo 53.º)',
  M16: 'Isento artigo 14.º do RITI',
  M19: 'Outras isenções',
  M99: 'Não sujeito ou não tributado',
}

export const taxaLabel = t => (t.taxa ? `${String(t.taxa).replace('.', ',')}%` : `Isento${t.isencao ? ` (${t.isencao})` : ''}`)
const keyOf = t => `${Number(t.taxa)}|${t.taxa ? '' : t.isencao || ''}`

// Quadro de um conjunto de documentos: linhas por taxa + totais + conferência com o IVA
// que cada documento declara (TaxPayable), para apanhar diferenças de arredondamento.
export function mapaIva(docs) {
  const rows = new Map()
  let docsSemTaxas = 0
  let ivaDocumentos = 0
  let documentos = 0
  for (const d of docs.filter(docCounts)) {
    const sign = docSign(d)
    documentos++
    ivaDocumentos = sum([ivaDocumentos, sign * Number(d.iva || 0)])
    const taxas = Array.isArray(d.por_taxa) ? d.por_taxa : []
    if (!taxas.length) { docsSemTaxas++; continue }
    for (const t of taxas) {
      const k = keyOf(t)
      if (!rows.has(k)) rows.set(k, { taxa: Number(t.taxa), isencao: t.taxa ? '' : t.isencao || '', base: 0, iva: 0, documentos: 0 })
      const r = rows.get(k)
      r.base = sum([r.base, sign * Number(t.base || 0)])
      r.iva = sum([r.iva, sign * Number(t.iva || 0)])
      r.documentos++
    }
  }
  const linhas = [...rows.values()].sort((a, b) => b.taxa - a.taxa || a.isencao.localeCompare(b.isencao))
    .map(r => ({ ...r, total: sum([r.base, r.iva]) }))
  const base = sum(linhas.map(r => r.base))
  const iva = sum(linhas.map(r => r.iva))
  return { linhas, base, iva, total: sum([base, iva]), documentos, docsSemTaxas, ivaDocumentos, diferencaIva: sub(ivaDocumentos, iva) }
}

// Mapa por mês de um ano: { meses: [{ mes, base, iva, porTaxa: { chave: { base, iva } } }], taxas: [...] }
export function mapaIvaAno(docs, year) {
  const doAno = docs.filter(d => String(d.data || '').startsWith(`${year}-`))
  const porMes = new Map()
  for (const d of doAno) {
    const m = monthOf(d.data)
    if (!porMes.has(m)) porMes.set(m, [])
    porMes.get(m).push(d)
  }
  const meses = [...porMes.keys()].sort().map(mes => ({ mes, ...mapaIva(porMes.get(mes)) }))
  const taxas = new Map()
  for (const m of meses) for (const l of m.linhas) taxas.set(keyOf(l), { taxa: l.taxa, isencao: l.isencao })
  return {
    meses: meses.map(m => ({ ...m, porTaxa: Object.fromEntries(m.linhas.map(l => [keyOf(l), l])) })),
    taxas: [...taxas.entries()].sort(([, a], [, b]) => b.taxa - a.taxa || a.isencao.localeCompare(b.isencao)).map(([key, t]) => ({ key, ...t })),
    total: mapaIva(doAno),
  }
}
