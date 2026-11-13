import { zipSync, strToU8 } from 'fflate'
import { decimalPt, toCsv } from './csv.js'

// Exportar os ficheiros originais (PDF/fotos) de várias faturas num só ZIP, para enviar à contabilidade.
// Cada ficheiro fica com um nome que diz o que é: "001 2026-10-03 Fornecedor FT 12 45,30€.pdf",
// numerados pela data para ficarem por ordem na pasta. Junta-se uma lista (CSV) com todas as faturas.

const EXT_BY_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }

const clean = (v, max = 40) => String(v ?? '')
  .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)
  .trim()

function extensionOf(file) {
  const fromName = String(file?.nome_ficheiro || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)
  return fromName ? fromName[1] : EXT_BY_MIME[file?.mime] || 'bin'
}

// Plano do ZIP: que ficheiro do bucket entra com que nome. Ordena pela data da fatura.
export function zipPlan(rows) {
  const sorted = [...rows].sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')) || String(a.fornecedor ?? '').localeCompare(String(b.fornecedor ?? '')))
  const pad = String(sorted.length).length < 3 ? 3 : String(sorted.length).length
  const entries = []
  const withoutFiles = []
  const used = new Set()
  sorted.forEach((r, i) => {
    const files = r.source?.invoice_files || []
    if (!files.length) { withoutFiles.push(r); return }
    const valor = r.valor == null ? '' : `${decimalPt(r.valor)}€`
    const base = [String(i + 1).padStart(pad, '0'), r.data || 'sem-data', clean(r.fornecedor) || 'Sem fornecedor', clean(r.documento, 30), valor].filter(Boolean).join(' ')
    files.forEach((f, j) => {
      let name = `${base}${files.length > 1 ? ` (${j + 1})` : ''}.${extensionOf(f)}`
      for (let k = 2; used.has(name.toLowerCase()); k++) name = name.replace(/(?: #\d+)?(\.[^.]+)$/, ` #${k}$1`)
      used.add(name.toLowerCase())
      entries.push({ name, path: f.storage_path, mime: f.mime, row: r })
    })
  })
  return { entries, withoutFiles, sorted }
}

export function listaCsv(sorted, names) {
  return toCsv(
    ['Data', 'Fornecedor', 'Documento', 'Descrição', 'Categoria', 'Pagamento', 'Estado', 'IVA', 'Valor', 'Ficheiros no ZIP'],
    sorted.map(r => [r.data, r.fornecedor, r.documento, r.descricao, r.categoria, r.pagamento, r.estado, r.source?.iva == null ? '' : decimalPt(r.source.iva), decimalPt(r.valor), (names.get(r.id) || []).join(' | ') || 'Sem ficheiro']),
  )
}

// download(path) -> Promise<Uint8Array|ArrayBuffer|Blob>. Devolve o ZIP e o que falhou.
export async function buildInvoicesZip(rows, download, { onProgress } = {}) {
  const { entries, withoutFiles, sorted } = zipPlan(rows)
  const files = {}
  const failed = []
  const names = new Map()
  let done = 0
  for (const e of entries) {
    try {
      const data = await download(e.path)
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data instanceof ArrayBuffer ? data : await data.arrayBuffer())
      files[e.name] = [buf, { level: 0 }] // PDF e fotos já vêm comprimidos
      names.set(e.row.id, [...(names.get(e.row.id) || []), e.name])
    } catch {
      failed.push(e)
    }
    onProgress?.(++done, entries.length)
  }
  files['lista-faturas.csv'] = strToU8(listaCsv(sorted, names))
  return { zip: zipSync(files), count: entries.length - failed.length, failed, withoutFiles }
}
