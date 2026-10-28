// Responde a perguntas em linguagem natural sobre os dados da FaturaClaro (página Perguntar).
// Corre no servidor do Netlify: a ANTHROPIC_API_KEY nunca chega ao navegador. As consultas usam o
// login de quem pergunta (chave anon + token do utilizador), por isso as permissões RLS aplicam-se.
// Só leitura: as ferramentas apenas fazem select.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { SYSTEM_PROMPT, TOOLS, correrFerramenta, validarHistorico } from '../../src/lib/perguntas.js'
import { friendlyClaudeError } from './ler-fatura.mjs'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const MAX_RONDAS = 8
// O Netlify corta as funções aos 60 s: a partir daqui pede-se a resposta com o que já se sabe.
export const TEMPO_LIMITE_MS = 42_000
// Resultados de ferramentas muito grandes ficam cortados para não encarecer a pergunta.
const MAX_RESULTADO = 40_000

const textoFinal = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()

// Separado do handler para poder ser testado com clientes simulados.
export async function answerQuestion({ supabase, anthropic, token, body, model = 'claude-opus-5-5', now = Date.now }) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await supabase.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await supabase.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return json(403, { error: 'Só a administradora pode fazer perguntas sobre os dados.' })

  const { value: historico, error } = validarHistorico(body?.mensagens)
  if (error) return json(400, { error })

  const hoje = new Date(now()).toISOString().slice(0, 10)
  const messages = [...historico]
  // A data de hoje vai no fim (e não no system) para não estragar a cache do início do pedido.
  messages[messages.length - 1] = { role: 'user', content: `${historico.at(-1).content}\n\n(Hoje é ${hoje}.)` }
  const inicio = now()
  const cache = {}
  const uso = { input: 0, output: 0, cache_read: 0, rondas: 0 }

  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const semTempo = now() - inicio > TEMPO_LIMITE_MS || ronda === MAX_RONDAS - 1
    let msg
    try {
      msg = await anthropic.messages.create({
        model,
        max_tokens: 8000,
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        // Na última ronda já não há consultas: responde com o que tem.
        ...(semTempo ? { tool_choice: { type: 'none' } } : {}),
        output_config: { effort: 'low' },
        messages,
      })
    } catch (err) {
      console.error('perguntar: erro da Anthropic', err?.status, err?.message)
      return json(502, { error: friendlyClaudeError(err) })
    }
    uso.rondas++
    uso.input += msg.usage?.input_tokens || 0
    uso.output += msg.usage?.output_tokens || 0
    uso.cache_read += msg.usage?.cache_read_input_tokens || 0

    if (msg.stop_reason === 'refusal') return json(422, { error: 'Não foi possível responder a esta pergunta.' })
    const pedidos = msg.content.filter(b => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || !pedidos.length) {
      const resposta = textoFinal(msg)
      if (!resposta) return json(422, { error: 'Não consegui responder. Tenta escrever a pergunta de outra forma.' })
      console.log('perguntar: uso', JSON.stringify(uso))
      return json(200, { resposta, uso })
    }

    messages.push({ role: 'assistant', content: msg.content })
    const resultados = await Promise.all(pedidos.map(async p => {
      const r = await correrFerramenta(supabase, p.name, p.input, cache)
      let text = JSON.stringify(r)
      if (text.length > MAX_RESULTADO) text = `${text.slice(0, MAX_RESULTADO)}… (resultado cortado: pede menos linhas ou colunas)`
      return { type: 'tool_result', tool_use_id: p.id, content: text, ...(r?.erro ? { is_error: true } : {}) }
    }))
    messages.push({ role: 'user', content: resultados })
  }
  return json(422, { error: 'A pergunta precisou de demasiadas consultas. Tenta dividi-la em perguntas mais simples.' })
}

export default async req => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'Perguntas desligadas: falta a ANTHROPIC_API_KEY no Netlify.', desligada: true })
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return json(500, { error: 'Falta configurar o Supabase nas variáveis de ambiente do Netlify.' })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  let body
  try { body = await req.json() } catch { return json(400, { error: 'Pedido inválido.' }) }
  return answerQuestion({ supabase, anthropic: new Anthropic(), token, body, model: process.env.ANTHROPIC_MODEL || undefined })
}
