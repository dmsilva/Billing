// Lê o horário dos funcionários em PDF (página Ordenados) e devolve a grelha de um mês.
// Corre no servidor do Netlify: a ANTHROPIC_API_KEY nunca chega ao navegador.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { HORARIO_SCHEMA, grelhaDoPdf, horarioPrompt } from '../../src/lib/horarioPdf.js'
import { contentBlocks, friendlyClaudeError } from './ler-fatura.mjs'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Separado do handler para poder ser testado com clientes simulados.
export async function readSchedule({ supabase, anthropic, token, body, model = 'claude-opus-5-5' }) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await supabase.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await supabase.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return json(403, { error: 'Só a administração pode ler o horário.' })

  if (body?.file?.media_type !== 'application/pdf') return json(400, { error: 'O horário tem de ser um PDF.' })
  const { blocks, error } = contentBlocks([body.file])
  if (error) return json(400, { error })
  const ano = Number.isInteger(body.ano) ? body.ano : null
  const mes = Number.isInteger(body.mes) && body.mes >= 1 && body.mes <= 12 ? body.mes : null

  let msg
  try {
    msg = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: HORARIO_SCHEMA } },
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: horarioPrompt(ano, mes) }] }],
    })
  } catch (err) {
    console.error('ler-horario: erro da Anthropic', err?.status, err?.message)
    return json(502, { error: friendlyClaudeError(err) })
  }
  const text = msg.content.find(b => b.type === 'text')?.text
  if (msg.stop_reason !== 'end_turn' || !text) {
    console.error('ler-horario: sem resposta utilizável', msg.stop_reason)
    return json(422, { error: 'Não foi possível ler este horário.' })
  }
  try {
    return json(200, grelhaDoPdf(JSON.parse(text)))
  } catch (e) {
    return json(422, { error: e instanceof SyntaxError ? 'Não foi possível ler este horário.' : e.message })
  }
}

export default async req => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'Leitura automática desligada: falta a ANTHROPIC_API_KEY no Netlify.', desligada: true })
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return json(500, { error: 'Falta configurar o Supabase nas variáveis de ambiente do Netlify.' })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  let body
  try { body = await req.json() } catch { return json(400, { error: 'Pedido inválido.' }) }
  return readSchedule({ supabase, anthropic: new Anthropic(), token, body, model: process.env.ANTHROPIC_MODEL || undefined })
}
