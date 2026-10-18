import { BUCKET, supabase } from '../supabase'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
const ALLOWED = new Set(ACCEPTED.split(','))

export function safeName(name) {
  const base = String(name || 'ficheiro').normalize('NFD').replace(/[̀-ͯ]/g, '')
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'ficheiro'
}

export function validateFile(f) {
  const type = f.type || (f.name.toLowerCase().endsWith('.heic') ? 'image/heic' : '')
  if (!ALLOWED.has(type)) return `${f.name}: formato não aceite (usa foto JPG/PNG/HEIC ou PDF).`
  if (f.size > MAX_FILE_BYTES) return `${f.name}: ficheiro maior do que 20 MB.`
  return null
}

// Guarda o ficheiro original (sem compressão) no bucket privado e regista-o na fatura.
export async function uploadInvoiceFile({ file, invoiceId, userId }) {
  const path = `${userId}/${invoiceId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName(file.name)}`
  const contentType = file.type || 'image/heic'
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType, upsert: false })
  if (upErr) throw upErr
  const { data, error } = await supabase
    .from('invoice_files')
    .insert({ invoice_id: invoiceId, storage_path: path, nome_ficheiro: file.name, mime: contentType, tamanho: file.size, uploaded_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

// Links temporários (1 hora): os documentos nunca ficam públicos.
export async function signedUrl(path, download) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download: true } : undefined)
  if (error) throw error
  return data.signedUrl
}

export async function deleteInvoiceFile(file) {
  const { error } = await supabase.storage.from(BUCKET).remove([file.storage_path])
  if (error) throw error
  const { error: e2 } = await supabase.from('invoice_files').delete().eq('id', file.id)
  if (e2) throw e2
}
