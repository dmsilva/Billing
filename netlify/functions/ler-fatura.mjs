// Lê a foto ou o PDF de uma fatura e devolve fornecedor, NIF, data, nº, valores e as linhas de artigos.
// Corre no servidor do Netlify: a ANTHROPIC_API_KEY nunca chega ao navegador.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { READING_SCHEMA, normalizeReading, readingPrompt } from '../../src/lib/invoiceReading.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const MAX_FILES = 4
// O Netlify aceita pedidos até 6 MB; as fotos chegam já reduzidas pelo navegador.
export const MAX_BASE64_CHARS = 5_500_000
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function contentBlocks(files) {
  if (!Array.isArray(files) || !files.length) return { error: 'Não chegou nenhum ficheiro para ler.' }
  if (files.length > MAX_FILES) return { error: `Só é possível ler até ${MAX_FILES} ficheiros de cada vez.` }
  let total = 0
  const blocks = []
  for (const f of files) {
    const data = typeof f?.data === 'string' ? f.data : ''
    total += data.length
    if (!data) return { error: 'Ficheiro vazio.' }
    if (IMAGE_TYPES.has(f.media_type)) blocks.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data } })
    else if (f.media_type === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
    else return { error: 'Formato que não é possível ler automaticamente.' }
  }
  if (total > MAX_BASE64_CHARS) return { error: 'Ficheiros demasiado grandes para leitura automática.' }
  return { blocks }
}

// Mensagem útil para quem está na receção; o detalhe técnico fica nos registos do Netlify.
export function friendlyClaudeError(err) {
  const status = err?.status
  const text = String(err?.message || '')
  if (/credit balance/i.test(text)) return 'A conta da Anthropic não tem saldo. Carrega créditos em console.anthropic.com (Billing).'
  if (status === 401) return 'A ANTHROPIC_API_KEY configurada no Netlify não é válida.'
  if (status === 403) return 'A chave da Anthropic não tem permissão para este pedido.'
  if (status === 404) return 'O modelo de leitura não está disponível para esta conta da Anthropic.'
  if (status === 413) return 'O ficheiro é demasiado grande para ser lido.'
  if (status === 429) return 'Foram feitos muitos pedidos seguidos. Tenta outra vez daqui a um minuto.'
  if (status === 529 || status >= 500) return 'O serviço de leitura está temporariamente indisponível. Tenta outra vez daqui a pouco.'
  if (status === 400) return `A leitura automática recusou o pedido: ${text.slice(0, 200)}`
  return 'A leitura automática falhou.'
}

// Separado do handler para poder ser testado com clientes simulados.
export async function readInvoice({ supabase, anthropic, token, body, model = 'claude-opus-5-5' }) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await supabase.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await supabase.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (!['admin', 'rececao'].includes(me?.role)) return json(403, { error: 'Sem permissão para enviar faturas.' })

  const { blocks, error } = contentBlocks(body?.files)
  if (error) return json(400, { error })

  // Nomes de artigos já usados (só existe depois do supabase/11_artigos_faturas.sql).
  let artigos = []
  try {
    const { data } = await supabase.rpc('artigos_conhecidos')
    if (Array.isArray(data)) artigos = data
  } catch { /* sem a função a leitura funciona na mesma */ }

  let msg
  try {
    msg = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: READING_SCHEMA } },
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: readingPrompt(artigos) }] }],
    })
  } catch (err) {
    console.error('ler-fatura: erro da Anthropic', err?.status, err?.message)
    return json(502, { error: friendlyClaudeError(err) })
  }
  const text = msg.content.find(b => b.type === 'text')?.text
  if (msg.stop_reason !== 'end_turn' || !text) {
    console.error('ler-fatura: sem resposta utilizável', msg.stop_reason)
    return json(422, { error: 'Não foi possível ler esta fatura.' })
  }
  try {
    return json(200, { leitura: normalizeReading(JSON.parse(text)) })
  } catch {
    return json(422, { error: 'Não foi possível ler esta fatura.' })
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
  return readInvoice({ supabase, anthropic: new Anthropic(), token, body, model: process.env.ANTHROPIC_MODEL || undefined })
}
