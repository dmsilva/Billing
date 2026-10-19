import { localMode, supabase } from '../supabase'

// Cria uma conta: em produção através da função do Netlify (que tem a chave de serviço),
// no modo local diretamente na base do navegador.
export async function createUser(input) {
  if (localMode) return supabase.admin.createUser(input)
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/criar-utilizador', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify(input),
    })
  } catch (e) {
    return { error: `Sem ligação ao servidor: ${e.message}` }
  }
  if (res.status === 404) return { error: 'A função de criar contas não está disponível aqui. Funciona no site publicado no Netlify (ou com "netlify dev").' }
  const body = await res.json().catch(() => ({}))
  return res.ok ? { profile: body.profile, convite: body.convite } : { error: body.error || `Erro ${res.status}` }
}
