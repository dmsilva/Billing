// Ir buscar o SAF-T de um mês ao InvoiceXpress e importá-lo (faturado oficial + mapa de IVA).
// Corre só nas funções do Netlify: a chave de API do InvoiceXpress nunca chega ao navegador.
//
// API: GET https://<conta>.app.invoicexpress.com/api/export_saft.json?api_key=…&month=10&year=2026
//  - 202: o InvoiceXpress começou a preparar o ficheiro; pedir outra vez daqui a uns segundos.
//  - 200: { Url } para descarregar o SAF-T (.zip ou .xml).
//  - 422: não há documentos nesse mês.  - 401: chave inválida.
import { parseSaft, saftText } from './saft.js'

// Aceita "chaletdavila", "chaletdavila.app.invoicexpress.com" ou o endereço completo.
export function contaDe(raw) {
  const s = String(raw || '').trim().toLowerCase()
  const m = /^(?:https?:\/\/)?([a-z0-9-]+)(?:\.app\.invoicexpress\.com)?(?:[/?#].*)?$/.exec(s)
  return m ? m[1] : ''
}

// Mês a ir buscar numa corrida automática: nos primeiros dias do mês fecha-se o mês anterior
// (apanha as últimas faturas e correções); no resto do mês atualiza-se o mês corrente.
export function mesAutomatico(hoje = new Date(), diasParaFechar = 5) {
  const y = hoje.getUTCFullYear()
  const m = hoje.getUTCMonth() + 1
  if (hoje.getUTCDate() <= diasParaFechar) return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  return `${y}-${String(m).padStart(2, '0')}`
}

export const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function urlExportSaft(conta, apiKey, mes) {
  const [ano, m] = mes.split('-')
  const q = new URLSearchParams({ api_key: apiKey, month: String(Number(m)), year: ano })
  return `https://${conta}.app.invoicexpress.com/api/export_saft.json?${q}`
}

// Um pedido à API. Devolve { estado: 'ok', url } | { estado: 'a_preparar' } | { estado: 'sem_documentos' }.
export async function pedirSaft({ conta, apiKey, mes, fetchImpl = fetch }) {
  const res = await fetchImpl(urlExportSaft(conta, apiKey, mes), { headers: { accept: 'application/json' } })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (res.status === 202) return { estado: 'a_preparar' }
  if (res.status === 422) return { estado: 'sem_documentos' }
  if (res.status === 401 || res.status === 403) throw new Error('O InvoiceXpress recusou a chave de API. Confirma a chave e o nome da conta nas variáveis do Netlify.')
  if (res.status === 404) throw new Error(`Conta "${conta}" não encontrada no InvoiceXpress. Confirma o nome da conta (a parte antes de .app.invoicexpress.com).`)
  if (!res.ok) throw new Error(`O InvoiceXpress respondeu com erro ${res.status}${body?.errors ? `: ${JSON.stringify(body.errors)}` : ''}.`)
  const url = body?.Url || body?.url
  if (url) return { estado: 'ok', url }
  if (body?.message) return { estado: 'sem_documentos' }
  return { estado: 'a_preparar' }
}

const pausa = ms => new Promise(r => setTimeout(r, ms))

// Pede o SAF-T, espera enquanto o InvoiceXpress o prepara (até esperarMs), descarrega, lê e importa.
// admin: cliente Supabase com a chave service_role. Regista sempre o resultado em invoicexpress_sincronizacoes.
export async function sincronizarMes({ admin, conta, apiKey, mes, automatico = false, esperarMs = 0, intervaloMs = 4000, fetchImpl = fetch }) {
  const registar = async (estado, extra = {}) => {
    await admin.from('invoicexpress_sincronizacoes').insert({ mes, estado, automatico, ...extra })
    return { mes, estado, ...extra }
  }
  try {
    if (!conta || !apiKey) throw new Error('Falta configurar INVOICEXPRESS_CONTA e INVOICEXPRESS_API_KEY nas variáveis de ambiente do Netlify.')
    if (!MES_RE.test(mes || '')) throw new Error('Mês inválido.')
    const fim = Date.now() + esperarMs
    let r = await pedirSaft({ conta, apiKey, mes, fetchImpl })
    while (r.estado === 'a_preparar' && Date.now() + intervaloMs < fim) {
      await pausa(intervaloMs)
      r = await pedirSaft({ conta, apiKey, mes, fetchImpl })
    }
    if (r.estado === 'a_preparar') return await registar('a_preparar', { mensagem: 'O InvoiceXpress está a preparar o ficheiro.' })
    if (r.estado === 'sem_documentos') return await registar('sem_documentos', { mensagem: 'Sem documentos neste mês.', documentos: 0, total: 0 })

    const file = await fetchImpl(r.url)
    if (!file.ok) throw new Error(`Não foi possível descarregar o SAF-T do InvoiceXpress (erro ${file.status}).`)
    const parsed = parseSaft(await saftText(new Uint8Array(await file.arrayBuffer())))
    const info = { ...parsed.info, ficheiro: `InvoiceXpress ${mes}`, origem: 'invoicexpress' }
    const { data, error } = await admin.rpc('importar_saft', { p_info: info, p_docs: parsed.docs, p_recibos_fora: parsed.recibosFora })
    if (error) throw new Error(`Falhou a gravação no Supabase: ${error.message}`)
    return await registar('ok', { documentos: data?.documentos ?? parsed.docs.length, total: info.total, mensagem: `${info.empresa || ''} ${info.inicio} a ${info.fim}`.trim() })
  } catch (e) {
    try { return await registar('erro', { mensagem: e.message }) } catch { return { mes, estado: 'erro', mensagem: e.message } }
  }
}
