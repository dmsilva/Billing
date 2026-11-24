import { localMode, supabase } from '../supabase'

const MAX_BYTES = 3.5 * 1024 * 1024
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

// Envia prints (ou PDFs) das faturas da Makro para a função ler-makro. Devolve { datas: ['AAAA-MM-DD', …] } ou { error }.
export async function lerDatasMakro(files) {
  const lista = [...files].slice(0, 4)
  if (!lista.length) return { error: 'Escolhe um print ou PDF.' }
  if (lista.some(f => !TIPOS.has(f.type))) return { error: 'Só dá para ler fotos/prints (JPG, PNG) ou PDF.' }
  if (lista.some(f => f.size > MAX_BYTES)) return { error: 'Ficheiro demasiado grande (máx. 3,5 MB).' }
  if (localMode) return { error: 'A leitura automática só funciona na app publicada.' }
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/ler-makro', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify({ files: await Promise.all(lista.map(async f => ({ media_type: f.type, data: await toBase64(f) }))), hoje: new Date().toISOString().slice(0, 10) }),
    })
  } catch {
    return { error: 'Sem ligação. Tenta outra vez.' }
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok && Array.isArray(body.datas)) return body
  if (res.status === 404) return { error: 'A leitura ainda não está publicada.' }
  return { error: body.error || `Erro ${res.status}` }
}
