import { BUCKET, localMode, supabase } from '../supabase'
import { fileType, linesToRows } from '../lib/invoiceReading'

const MAX_SIDE = 1600
const MAX_PDF_BYTES = 3.5 * 1024 * 1024

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

// Cópia reduzida só para a leitura; o original guardado no Storage não é alterado.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('imagem ilegível')
  return { media_type: 'image/jpeg', data: await toBase64(blob) }
}

async function prepare(file) {
  const type = fileType(file)
  if (type === 'application/pdf') return file.size <= MAX_PDF_BYTES ? { media_type: type, data: await toBase64(file) } : null
  if (type.startsWith('image/')) {
    try { return await shrinkImage(file) } catch { return null } // HEIC só abre no Safari
  }
  return null
}

// Devolve { leitura } ou { error }; { desligada: true } quando a leitura não existe neste ambiente.
export async function readInvoiceFiles(files) {
  if (localMode) return { desligada: true }
  const prepared = (await Promise.all(files.slice(0, 4).map(prepare))).filter(Boolean)
  if (!prepared.length) return { error: 'Não foi possível ler este ficheiro automaticamente. Preenche os campos à mão.' }
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/ler-fatura', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify({ files: prepared }),
    })
  } catch {
    return { error: 'Sem ligação para ler a fatura. Preenche os campos à mão.' }
  }
  if (res.status === 404) return { desligada: true }
  const body = await res.json().catch(() => ({}))
  if (body.desligada) return { desligada: true }
  return res.ok ? { leitura: body.leitura } : { error: `${body.error || `Erro ${res.status}`} Preenche os campos à mão.` }
}

// Grava as linhas de artigos lidas na Receção na fatura acabada de enviar.
export async function saveReadLines(invoice, linhas) {
  const rows = linesToRows(linhas, invoice)
  if (!rows.length) return 0
  const { error } = await supabase.from('invoice_lines').insert(rows)
  if (error) throw error
  return rows.length
}

// Administração: volta a ler os ficheiros guardados de uma fatura e substitui as linhas lidas
// automaticamente (as escritas à mão ficam). Devolve { linhas } (as gravadas) ou { error }.
export async function readStoredInvoiceLines(invoice) {
  const stored = (invoice.invoice_files || []).slice(0, 4)
  if (!stored.length) return { error: 'A fatura não tem ficheiros.' }
  const files = []
  for (const f of stored) {
    const { data, error } = await supabase.storage.from(BUCKET).download(f.storage_path)
    if (error || !data) continue
    files.push(new File([data], f.nome_ficheiro || 'fatura', { type: f.mime || data.type || '' }))
  }
  if (!files.length) return { error: 'Não foi possível abrir os ficheiros da fatura.' }
  const res = await readInvoiceFiles(files)
  if (res.desligada) return { error: 'A leitura automática não está ligada neste ambiente.', desligada: true }
  if (res.error) return { error: res.error.replace(/ Preenche os campos à mão\.$/, '') }
  const rows = linesToRows(res.leitura?.linhas, invoice)
  const del = await supabase.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('lido_auto', true)
  if (del.error) return { error: del.error.message }
  let inserted = []
  if (rows.length) {
    const { data, error } = await supabase.from('invoice_lines').insert(rows).select()
    if (error) return { error: error.message }
    inserted = data
  }
  const { data: inv, error: upErr } = await supabase.from('invoices').update({ artigos_lidos_em: new Date().toISOString() }).eq('id', invoice.id).select().single()
  if (upErr) return { error: upErr.message }
  return { linhas: inserted, invoice: { ...invoice, artigos_lidos_em: inv.artigos_lidos_em } }
}
