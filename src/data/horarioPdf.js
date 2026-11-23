import { localMode, supabase } from '../supabase'

const MAX_PDF_BYTES = 3.5 * 1024 * 1024

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

// Envia o PDF do horário para a função ler-horario. Devolve { meses, ano, mes, grelha } ou { error }.
// ano/mes: o mês que se quer (sem eles, o modelo escolhe o mais recente).
export async function lerHorarioPdf(file, ano, mes) {
  if (localMode) return { error: 'A leitura do horário em PDF só funciona na app publicada. Aqui usa o Excel.' }
  if (file.size > MAX_PDF_BYTES) return { error: 'O PDF do horário é demasiado grande (máx. 3,5 MB). Exporta só os meses que precisas.' }
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/ler-horario', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify({ file: { media_type: 'application/pdf', data: await toBase64(file) }, ano, mes }),
    })
  } catch {
    return { error: 'Sem ligação para ler o horário. Tenta outra vez.' }
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok && body.grelha) return body
  if (res.status === 404) return { error: 'A leitura de PDF ainda não está publicada.' }
  if (res.status === 502 || res.status === 504) return { error: body.error || 'A leitura demorou demasiado. Tenta outra vez.' }
  return { error: body.error || `Erro ${res.status}` }
}
