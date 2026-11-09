import { localMode, supabase } from '../supabase'

// Pede à função do Netlify o SAF-T de um mês (AAAA-MM) no InvoiceXpress. Enquanto o InvoiceXpress
// prepara o ficheiro volta a pedir sozinho (até ~2 minutos). Devolve { estado, documentos, total, mensagem } ou { error }.
export async function buscarSaftInvoiceXpress(mes, { tentativas = 24, intervaloMs = 5000, onEspera } = {}) {
  if (localMode) return { error: 'No modo local não há ligação ao InvoiceXpress.' }
  for (let i = 0; i < tentativas; i++) {
    const { data } = await supabase.auth.getSession()
    let res
    try {
      res = await fetch('/.netlify/functions/invoicexpress-saft', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify({ mes }),
      })
    } catch {
      return { error: 'Sem ligação. Tenta outra vez.' }
    }
    const body = await res.json().catch(() => ({}))
    if (res.status === 404) return { error: 'A ligação ao InvoiceXpress ainda não está publicada.' }
    if (!res.ok) return { error: body.error || body.mensagem || `Erro ${res.status}` }
    if (body.estado !== 'a_preparar') return body
    onEspera?.(i + 1)
    await new Promise(r => setTimeout(r, intervaloMs))
  }
  return { error: 'O InvoiceXpress está a demorar a preparar o ficheiro. Tenta outra vez daqui a uns minutos.' }
}
