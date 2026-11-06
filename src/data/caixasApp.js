import { localMode, supabase } from '../supabase'

// Pede à função do Netlify que vá buscar as caixas à app da receção e as grave.
// Sem datas, importa os dias em falta. Devolve o resumo ou { error } / { desligada: true }.
export async function importarCaixasApp(periodo = {}) {
  if (localMode) return { desligada: true, error: 'No modo local não há ligação à app de caixa.' }
  const { data } = await supabase.auth.getSession()
  let res
  try {
    res = await fetch('/.netlify/functions/caixas-app', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: JSON.stringify(periodo),
    })
  } catch {
    return { error: 'Sem ligação. Tenta outra vez.' }
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 404) return { desligada: true, error: 'A função de importação ainda não está publicada.' }
  if (res.ok) return body
  return { error: body.error || `Erro ${res.status}`, desligada: Boolean(body.desligada) }
}

// Importação automática: no máximo uma vez por hora neste navegador, quando a administradora abre a app.
const KEY = 'fatura-chalet:caixas-app-auto'
export function deveImportarAuto(now = Date.now(), storage = globalThis.localStorage) {
  try {
    const last = Number(storage?.getItem(KEY) || 0)
    if (now - last < 60 * 60 * 1000) return false
    storage?.setItem(KEY, String(now))
    return true
  } catch {
    return false
  }
}
