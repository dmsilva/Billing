import { describe, expect, it, vi } from 'vitest'
import { validateNewUser } from '../src/lib/users'
import { createUserAsAdmin } from '../netlify/functions/criar-utilizador.mjs'

describe('validação de novos utilizadores', () => {
  it('normaliza e valida', () => {
    expect(validateNewUser({ email: ' Ana@Ex.pt ', role: 'rececao' }).value).toMatchObject({ email: 'ana@ex.pt', nome: 'ana', modo: 'convite' })
    expect(validateNewUser({ email: 'x', role: 'rececao' }).error).toMatch(/Email/)
    expect(validateNewUser({ email: 'a@b.pt', role: 'pendente' }).error).toMatch(/papel/)
    expect(validateNewUser({ email: 'a@b.pt', role: 'admin', modo: 'password', password: '123' }).error).toMatch(/8/)
  })
})

function fakeAdmin({ role = 'admin', createError = null } = {}) {
  const upserts = []
  const query = table => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === 'profiles' ? { role } : null }),
      upsert: row => { upserts.push(row); q.row = row; return q },
      single: async () => ({ data: q.row, error: null }),
    }
    return q
  }
  return {
    upserts,
    from: query,
    auth: {
      getUser: async t => (t === 'bom' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'x' } }),
      admin: {
        createUser: vi.fn(async () => (createError ? { error: createError } : { data: { user: { id: 'novo' } }, error: null })),
        inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: 'conv' } }, error: null })),
      },
    },
  }
}

describe('função criar-utilizador', () => {
  const body = { email: 'ana@ex.pt', nome: 'Ana', role: 'rececao', modo: 'password', password: '12345678' }
  it('recusa sem sessão ou sem ser administradora', async () => {
    expect((await createUserAsAdmin(fakeAdmin(), '', body, 'https://x')).status).toBe(401)
    expect((await createUserAsAdmin(fakeAdmin(), 'mau', body, 'https://x')).status).toBe(401)
    expect((await createUserAsAdmin(fakeAdmin({ role: 'rececao' }), 'bom', body, 'https://x')).status).toBe(403)
  })
  it('cria com palavra-passe e atribui o papel', async () => {
    const a = fakeAdmin()
    const res = await createUserAsAdmin(a, 'bom', body, 'https://x')
    expect(res.status).toBe(200)
    expect(a.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@ex.pt', email_confirm: true }))
    expect(a.upserts[0]).toMatchObject({ id: 'novo', role: 'rececao', nome: 'Ana' })
  })
  it('envia convite com redirecionamento para definir a palavra-passe', async () => {
    const a = fakeAdmin()
    const res = await createUserAsAdmin(a, 'bom', { ...body, modo: 'convite' }, 'https://faturaclaro.netlify.app')
    expect((await res.json()).convite).toBe(true)
    expect(a.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('ana@ex.pt', expect.objectContaining({ redirectTo: 'https://faturaclaro.netlify.app/nova-password' }))
  })
  it('explica emails repetidos', async () => {
    const res = await createUserAsAdmin(fakeAdmin({ createError: { status: 422, message: 'A user with this email address has already been registered' } }), 'bom', body, 'https://x')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Já existe uma conta com este email.')
  })
})
