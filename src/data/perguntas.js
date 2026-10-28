import { localMode, supabase } from '../supabase'

// Envia a conversa para a função do Netlify. Devolve { resposta } ou { error }; { desligada: true }
// quando as perguntas não existem neste ambiente (modo local ou sem ANTHROPIC_API_KEY).
export async function perguntar(mensagens) {
  if (localMode) return { desligada: true }
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/perguntar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify({ mensagens }),
    })
  } catch {
    return { error: 'Sem ligação. Tenta outra vez.' }
  }
  if (res.status === 404) return { desligada: true }
  const body = await res.json().catch(() => ({}))
  if (body.desligada) return { desligada: true }
  if (res.ok && body.resposta) return { resposta: body.resposta }
  if (res.status === 502 || res.status === 504) return { error: body.error || 'A resposta demorou demasiado. Tenta uma pergunta mais simples.' }
  return { error: body.error || `Erro ${res.status}` }
}
