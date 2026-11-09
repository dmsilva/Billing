// Botão "Ir buscar ao InvoiceXpress" da página Faturado: a administradora pede um mês e a função
// vai buscar o SAF-T ao InvoiceXpress e importa-o. A chave do InvoiceXpress e a service_role
// ficam nas variáveis de ambiente do Netlify e nunca chegam ao navegador.
import { createClient } from '@supabase/supabase-js'
import { contaDe, MES_RE, sincronizarMes } from '../../src/lib/invoicexpress.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function pedidoAdmin(admin, token, body, opts) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return json(403, { error: 'Só a administradora pode ir buscar o SAF-T.' })
  const mes = String(body?.mes || '')
  if (!MES_RE.test(mes)) return json(400, { error: 'Mês inválido.' })
  const r = await sincronizarMes({ admin, mes, ...opts })
  return json(r.estado === 'erro' ? 502 : 200, r)
}

export default async req => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return json(500, { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do Netlify.' })
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let body
  try { body = await req.json() } catch { return json(400, { error: 'Pedido inválido.' }) }
  // Pedido curto (as funções do Netlify param aos 10 s): se o ficheiro ainda não estiver pronto,
  // a página volta a pedir sozinha daqui a uns segundos.
  return pedidoAdmin(admin, token, body, { conta: contaDe(process.env.INVOICEXPRESS_CONTA), apiKey: process.env.INVOICEXPRESS_API_KEY, esperarMs: 5000, intervaloMs: 2500 })
}
