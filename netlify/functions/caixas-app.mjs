// Importa as caixas da app de caixa da receção (caixa-chaletdavila.netlify.app).
// Corre no servidor do Netlify: a CAIXA_EXPORT_KEY nunca chega ao navegador. A gravação usa o login
// de quem importa (chave anon + token do utilizador), por isso só a administradora consegue gravar.
import { createClient } from '@supabase/supabase-js'
import { diasDaResposta, hojeLisboa, partirPeriodo, periodoEmFalta } from '../../src/lib/caixaApp.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ISO = /^\d{4}-\d{2}-\d{2}$/

// Separado do handler para poder ser testado com clientes simulados.
export async function importarCaixas({ supabase, token, body = {}, caixaUrl, caixaKey, fetchImpl = fetch, now = () => new Date() }) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await supabase.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await supabase.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return json(403, { error: 'Só a administradora pode importar as caixas.' })

  const hoje = hojeLisboa(now())
  let periodo
  if (body.from || body.to) {
    if (!ISO.test(body.from || '') || !ISO.test(body.to || '') || body.from > body.to) return json(400, { error: 'Datas inválidas.' })
    periodo = { from: body.from, to: body.to > hoje ? hoje : body.to }
  } else {
    const { data: dias, error } = await supabase.from('caixa_app_dias').select('data, dia_fechado')
    if (error) return json(500, { error: tabelaEmFalta(error) })
    periodo = periodoEmFalta(dias || [], hoje)
    if (!periodo) return json(200, { periodo: null, dias: 0, turnos: 0, fechos: 0, pendentes: 0 })
  }

  const total = { periodo, dias: 0, turnos: 0, fechos: 0, pendentes: 0 }
  const base = caixaUrl.replace(/\/+$/, '')
  for (const p of partirPeriodo(periodo.from, periodo.to)) {
    let res
    try {
      res = await fetchImpl(`${base}/api/export?from=${p.from}&to=${p.to}`, { headers: { 'X-Api-Key': caixaKey, accept: 'application/json' } })
    } catch (err) {
      console.error('caixas-app: sem ligação', err?.message)
      return json(502, { error: 'Não foi possível ligar à app de caixa. Tenta outra vez.' })
    }
    if (res.status === 401 || res.status === 403) return json(502, { error: 'A app de caixa recusou a chave (CAIXA_EXPORT_KEY).' })
    if (!res.ok) return json(502, { error: `A app de caixa respondeu com erro ${res.status}.` })
    let corpo, dados
    try {
      corpo = await res.json()
      dados = diasDaResposta(corpo)
    } catch (err) {
      return json(502, { error: err instanceof SyntaxError ? 'A app de caixa devolveu uma resposta inválida.' : err.message })
    }
    if (!dados.length) continue
    const geradoEm = typeof corpo.geradoEm === 'string' && !Number.isNaN(Date.parse(corpo.geradoEm)) ? corpo.geradoEm : null
    const { data: r, error } = await supabase.rpc('importar_caixas_app', { p_dias: dados, p_gerado_em: geradoEm })
    if (error) return json(500, { error: tabelaEmFalta(error) })
    for (const k of ['dias', 'turnos', 'fechos', 'pendentes']) total[k] += Number(r?.[k] || 0)
  }
  return json(200, total)
}

function tabelaEmFalta(error) {
  const msg = error?.message || String(error)
  if (/caixa_app|importar_caixas_app|does not exist|schema cache/i.test(msg)) return 'Falta correr o SQL 15 (15_caixas_app.sql) no Supabase.'
  return msg
}

export default async req => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })
  const caixaUrl = process.env.CAIXA_URL
  const caixaKey = process.env.CAIXA_EXPORT_KEY
  if (!caixaUrl || !caixaKey) return json(503, { error: 'Falta configurar CAIXA_URL e CAIXA_EXPORT_KEY no Netlify.', desligada: true })
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return json(500, { error: 'Falta configurar o Supabase nas variáveis de ambiente do Netlify.' })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  let body = {}
  try { body = await req.json() } catch { body = {} }
  return importarCaixas({ supabase, token, body, caixaUrl, caixaKey })
}
