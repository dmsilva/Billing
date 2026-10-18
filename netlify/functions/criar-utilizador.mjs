// Cria contas a partir da página Utilizadores. Corre no servidor do Netlify:
// a chave service_role fica numa variável de ambiente do Netlify e nunca chega ao navegador.
import { createClient } from '@supabase/supabase-js'
import { friendlyCreateError, validateNewUser } from '../../src/lib/users.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Separado do handler para poder ser testado com um cliente simulado.
export async function createUserAsAdmin(admin, token, body, origin) {
  if (!token) return json(401, { error: 'Sessão em falta. Volta a entrar.' })
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida. Volta a entrar.' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return json(403, { error: 'Só uma administradora pode criar contas.' })

  const { value, error } = validateNewUser(body || {})
  if (error) return json(400, { error })

  const meta = { nome: value.nome }
  const res = value.modo === 'password'
    ? await admin.auth.admin.createUser({ email: value.email, password: value.password, email_confirm: true, user_metadata: meta })
    : await admin.auth.admin.inviteUserByEmail(value.email, { data: meta, redirectTo: `${origin}/nova-password` })
  if (res.error) return json(res.error.status === 422 ? 409 : 400, { error: friendlyCreateError(res.error.message) })

  const id = res.data.user.id
  // O perfil é criado pelo trigger handle_new_user; aqui só se atribui o papel e o nome.
  const { data: profile, error: pErr } = await admin.from('profiles')
    .upsert({ id, email: value.email, nome: value.nome, role: value.role }, { onConflict: 'id' })
    .select().single()
  if (pErr) return json(500, { error: `Conta criada, mas falhou a atribuição do papel: ${pErr.message}` })
  return json(200, { profile, convite: value.modo === 'convite' })
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
  return createUserAsAdmin(admin, token, body, new URL(req.url).origin)
}
