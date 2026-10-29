// Modo local: imita o cliente Supabase com uma base PostgreSQL dentro do navegador (PGlite).
// Usa exatamente os mesmos SQL do Supabase (esquema, RLS, funções e dados reais migrados),
// guardados no IndexedDB deste navegador. Só para experimentar no próprio computador.

import { friendlyCreateError, validateNewUser } from '../lib/users'

export const LOCAL_DB_NAME = 'faturaclaro-local'
export const LOCAL_USERS = {
  'admin@local': { id: '00000000-0000-4000-8000-00000000000a', role: 'admin', nome: 'Administradora (local)' },
  'rececao@local': { id: '00000000-0000-4000-8000-00000000000b', role: 'rececao', nome: 'Receção (local)' },
}
const SESSION_KEY = 'faturaclaro-local-session'

// Embeds usados pela aplicação: tabela filha -> coluna que aponta para a tabela pai.
const EMBEDS = { invoices: { invoice_files: 'invoice_id' } }

const ident = name => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nome inválido: ${name}`)
  return `"${name}"`
}

function splitTopLevel(s) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// Converte a lista de colunas do PostgREST ("*, invoice_files(id, mime)") em SQL.
export function selectList(table, columns = '*', alias = 't') {
  return splitTopLevel(columns || '*').map(item => {
    if (item === '*') return `${alias}.*`
    const m = item.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/)
    if (m) {
      const [, child, inner] = m
      const fk = EMBEDS[table]?.[child]
      if (!fk) throw new Error(`Relação não suportada no modo local: ${table} -> ${child}`)
      const cols = splitTopLevel(inner).map(c => `'${c}', e.${ident(c)}`).join(', ')
      return `coalesce((select json_agg(json_build_object(${cols}) order by e.id) from ${ident(child)} e where e.${ident(fk)} = ${alias}.id), '[]'::json) as ${ident(child)}`
    }
    return `${alias}.${ident(item)}`
  }).join(', ')
}

// Listas de números/texto vão como array do PostgreSQL (ex.: bigint[]); objetos e listas de objetos como JSON.
const isPlainList = v => Array.isArray(v) && v.length > 0 && v.every(x => x === null || typeof x !== 'object')
const toParam = v => (v !== null && typeof v === 'object' && !(v instanceof Uint8Array) && !isPlainList(v) ? JSON.stringify(v) : v)
const fail = (e, code) => ({ data: null, error: { message: e?.message || String(e), code: e?.code || code || 'local' }, count: null })

export function createLocalClient({ dataDir = `idb://${LOCAL_DB_NAME}`, storage = globalThis.localStorage } = {}) {
  let dbPromise = null
  const db = () => (dbPromise ||= init())

  async function init() {
    // A condição é resolvida no build: o PGlite e os SQL nunca entram no build de produção.
    const mod = import.meta.env.MODE === 'production' ? null : await import('./pglite.js')
    if (!mod) throw new Error('Modo local indisponível no build de produção')
    const { PGlite, pgcrypto, SETUP_SQL, PAYMENTS_UPDATE_SQL, CREDITS_UPDATE_SQL, ENCARGOS_UPDATE_SQL, SALARIOS_UPDATE_SQL, ORDENADOS_UPDATE_SQL } = mod
    const pg = await PGlite.create({ dataDir, extensions: { pgcrypto } })
    const ready = await pg.query(`select to_regclass('public.cash_closes') is not null as ok`)
    if (!ready.rows[0].ok) {
      for (const sql of SETUP_SQL) await pg.exec(sql)
      await pg.exec(`create schema if not exists local; create table if not exists local.files (path text primary key, mime text, data bytea not null)`)
      for (const [email, u] of Object.entries(LOCAL_USERS)) {
        await pg.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing`, [u.id, email, JSON.stringify({ nome: u.nome })])
        await pg.query(`update public.profiles set role = $2 where id = $1`, [u.id, u.role])
      }
    }
    const payments = await pg.query(`select to_regclass('public.invoice_payments') is not null as ok`)
    if (!payments.rows[0].ok) for (const sql of PAYMENTS_UPDATE_SQL) await pg.exec(sql)
    const credits = await pg.query(`select to_regclass('public.transferencias') is not null as ok`)
    if (!credits.rows[0].ok) for (const sql of CREDITS_UPDATE_SQL) await pg.exec(sql)
    const encargos = await pg.query(`select to_regclass('public.encargos_pessoal') is not null as ok`)
    if (!encargos.rows[0].ok) for (const sql of ENCARGOS_UPDATE_SQL) await pg.exec(sql)
    const salarios = await pg.query(`select to_regclass('public.salarios_banco_envios') is not null as ok`)
    if (!salarios.rows[0].ok) for (const sql of SALARIOS_UPDATE_SQL) await pg.exec(sql)
    const ordenados = await pg.query(`select to_regclass('public.ordenados_envios') is not null as ok`)
    if (!ordenados.rows[0].ok) for (const sql of ORDENADOS_UPDATE_SQL) await pg.exec(sql)
    // Bases criadas antes da criação de contas não tinham esta tabela.
    await pg.exec(`create schema if not exists local; create table if not exists local.passwords (user_id uuid primary key references auth.users(id) on delete cascade, hash text not null)`)
    return pg
  }

  // Cada pedido corre como o utilizador com sessão, com o papel "authenticated", para o RLS se aplicar como no Supabase.
  async function run(sql, params = []) {
    const pg = await db()
    const user = currentSession()?.user
    return pg.transaction(async tx => {
      if (user) {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [user.id, JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated' })])
      }
      await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`)
      const res = await tx.query(sql, params.map(toParam))
      return res.rows
    })
  }

  // ---------- Autenticação ----------
  const listeners = new Set()
  const sessionFor = u => ({ access_token: 'local', token_type: 'bearer', user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { nome: u.nome } } })
  function currentSession() {
    try {
      const raw = storage?.getItem(SESSION_KEY)
      if (!raw) return null
      if (LOCAL_USERS[raw]) return sessionFor({ ...LOCAL_USERS[raw], email: raw })
      const u = JSON.parse(raw)
      return u?.id && u?.email ? sessionFor(u) : null
    } catch { return null }
  }
  const emit = (event, s) => listeners.forEach(cb => cb(event, s))

  const auth = {
    async getSession() { await db(); return { data: { session: currentSession() }, error: null } },
    onAuthStateChange(cb) {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
    // Contas criadas com palavra-passe têm de a usar; admin@local, rececao@local e contas convidadas aceitam qualquer uma.
    async signInWithPassword({ email, password }) {
      const key = String(email || '').trim().toLowerCase()
      const pg = await db()
      const { rows } = await pg.query(
        `select u.id, u.email, p.nome, pw.hash is null or pw.hash = crypt($2, pw.hash) as ok
         from auth.users u left join public.profiles p on p.id = u.id left join local.passwords pw on pw.user_id = u.id
         where lower(u.email) = $1`, [key, String(password || '')])
      if (!rows.length || !rows[0].ok) return { data: { session: null, user: null }, error: { message: rows.length ? 'Invalid login credentials' : 'No modo local entra com admin@local, rececao@local ou uma conta criada na página Utilizadores.' } }
      const s = sessionFor(rows[0])
      try { storage?.setItem(SESSION_KEY, JSON.stringify({ id: s.user.id, email: s.user.email, nome: rows[0].nome })) } catch { /* sem armazenamento: sessão só nesta página */ }
      emit('SIGNED_IN', s)
      return { data: { session: s, user: s?.user }, error: null }
    },
    async signOut() {
      try { storage?.removeItem(SESSION_KEY) } catch { /* ignorar */ }
      emit('SIGNED_OUT', null)
      return { error: null }
    },
    async resetPasswordForEmail() { return { data: null, error: { message: 'No modo local não há emails: entra com admin@local ou rececao@local.' } } },
    async updateUser() { return { data: { user: currentSession()?.user || null }, error: null } },
  }

  // ---------- Consultas (subconjunto do PostgREST usado pela aplicação) ----------
  class Query {
    constructor(table) {
      this.table = table
      this.op = 'select'
      this.columns = '*'
      this.returning = null
      this.filters = []
      this.orders = []
      this.mode = 'many'
    }
    select(columns = '*', { count } = {}) {
      if (count) this.count = count
      if (this.op === 'select') this.columns = columns
      else this.returning = columns
      return this
    }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this }
    upsert(rows, { onConflict = 'id', ignoreDuplicates = false } = {}) { this.op = 'upsert'; this.payload = rows; this.onConflict = onConflict; this.ignoreDuplicates = ignoreDuplicates; return this }
    update(patch) { this.op = 'update'; this.payload = patch; return this }
    delete() { this.op = 'delete'; return this }
    eq(col, value) { this.filters.push({ col, kind: 'eq', value }); return this }
    in(col, values) { this.filters.push({ col, kind: 'in', value: values }); return this }
    neq(col, value) { this.filters.push({ col, kind: '<>', value }); return this }
    gt(col, value) { this.filters.push({ col, kind: '>', value }); return this }
    gte(col, value) { this.filters.push({ col, kind: '>=', value }); return this }
    lt(col, value) { this.filters.push({ col, kind: '<', value }); return this }
    lte(col, value) { this.filters.push({ col, kind: '<=', value }); return this }
    ilike(col, value) { this.filters.push({ col, kind: 'ilike', value }); return this }
    is(col, value) { this.filters.push({ col, kind: value === null ? 'is null' : 'eq', value }); return this }
    not(col, op, value) {
      if (op !== 'is' || value !== null) throw new Error(`Filtro não suportado no modo local: not.${op}`)
      this.filters.push({ col, kind: 'is not null' }); return this
    }
    order(col, { ascending = true } = {}) { this.orders.push(`${ident(col)} ${ascending ? 'asc' : 'desc'}`); return this }
    range(from, to) { this.offset = from; this.lim = to - from + 1; return this }
    limit(n) { this.lim = n; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    then(resolve, reject) { return this.execute().then(resolve, reject) }

    where(params, alias = 't') {
      if (!this.filters.length) return ''
      return ' where ' + this.filters.map(f => {
        if (f.kind === 'eq') {
          if (f.value === null) return `${alias}.${ident(f.col)} is null`
          params.push(f.value)
          return `${alias}.${ident(f.col)} = $${params.length}`
        }
        if (f.kind === 'is null' || f.kind === 'is not null') return `${alias}.${ident(f.col)} ${f.kind}`
        if (f.kind !== 'in') {
          params.push(f.value)
          // Comparação como texto quando o valor é texto (datas, nomes); igual ao PostgREST na prática.
          return `${alias}.${ident(f.col)}${f.kind === 'ilike' ? '::text' : ''} ${f.kind} $${params.length}`
        }
        if (!f.value.length) return 'false'
        return `${alias}.${ident(f.col)} in (${f.value.map(v => { params.push(v); return `$${params.length}` }).join(', ')})`
      }).join(' and ')
    }

    build() {
      const T = ident(this.table)
      const params = []
      const wrap = (inner, cols) => `with r as (${inner}) select coalesce(json_agg(x), '[]'::json) as j from (select ${selectList(this.table, cols, 'r')} from r) x`
      if (this.op === 'select') {
        let inner = `select t.* from ${T} t${this.where(params)}`
        const order = this.orders.length ? ` order by ${this.orders.map(o => `t.${o}`).join(', ')}` : ''
        inner += order
        if (this.lim != null) inner += ` limit ${Number(this.lim)}`
        if (this.offset != null) inner += ` offset ${Number(this.offset)}`
        // Mantém a ordem pedida dentro do json_agg.
        const sql = `select coalesce(json_agg(x), '[]'::json) as j from (select ${selectList(this.table, this.columns, 'r')} from (${inner}) r${this.orders.length ? ` order by ${this.orders.map(o => `r.${o}`).join(', ')}` : ''}) x`
        return { sql, params }
      }
      if (this.op === 'delete') {
        return { sql: wrap(`delete from ${T} as t${this.where(params)} returning t.*`, this.returning || '*'), params }
      }
      if (this.op === 'update') {
        const cols = Object.keys(this.payload)
        params.push(this.payload)
        const set = cols.map(c => `${ident(c)} = p.${ident(c)}`).join(', ')
        return { sql: wrap(`update ${T} as t set ${set} from json_populate_record(null::${T}, $1::json) p${this.where(params)} returning t.*`, this.returning || '*'), params }
      }
      // insert / upsert
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))]
      params.push(rows)
      let inner = `insert into ${T} as t (${cols.map(ident).join(', ')}) select ${cols.map(c => `p.${ident(c)}`).join(', ')} from json_populate_recordset(null::${T}, $1::json) p`
      if (this.op === 'upsert') {
        const conflict = this.onConflict.split(',').map(s => s.trim())
        const updates = cols.filter(c => !conflict.includes(c))
        inner += ` on conflict (${conflict.map(ident).join(', ')}) ` + (this.ignoreDuplicates || !updates.length ? 'do nothing' : `do update set ${updates.map(c => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`)
      }
      inner += ' returning t.*'
      return { sql: wrap(inner, this.returning || '*'), params }
    }

    async execute() {
      try {
        const { sql, params } = this.build()
        const rows = (await run(sql, params))[0]?.j || []
        let count = null
        if (this.count && this.op === 'select') {
          const cp = []
          count = Number((await run(`select count(*)::int as n from ${ident(this.table)} t${this.where(cp)}`, cp))[0]?.n ?? 0)
        }
        const wantsRows = this.op === 'select' || this.returning != null
        if (!wantsRows) return { data: null, error: null, count: null, status: 204 }
        if (this.mode === 'single') {
          if (rows.length !== 1) return fail({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' })
          return { data: rows[0], error: null, count: null, status: 200 }
        }
        if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null, count: null, status: 200 }
        return { data: rows, error: null, count, status: 200 }
      } catch (e) {
        return fail(e)
      }
    }
  }

  async function rpc(fn, args = {}) {
    try {
      const names = Object.keys(args)
      const sql = `select to_json(public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})) as j`
      const rows = await run(sql, names.map(n => args[n]))
      return { data: rows[0]?.j ?? null, error: null }
    } catch (e) {
      return fail(e)
    }
  }

  // ---------- Ficheiros (bucket privado simulado dentro da mesma base local) ----------
  const objectUrls = new Map()
  const storageApi = {
    from: () => ({
      async upload(path, file, { contentType } = {}) {
        try {
          const pg = await db()
          const bytes = new Uint8Array(await file.arrayBuffer())
          await pg.query(`insert into local.files (path, mime, data) values ($1, $2, $3)`, [path, contentType || file.type || 'application/octet-stream', bytes])
          return { data: { path }, error: null }
        } catch (e) { return fail(e) }
      },
      async createSignedUrl(path) {
        try {
          const pg = await db()
          const { rows } = await pg.query(`select mime, data from local.files where path = $1`, [path])
          if (!rows.length) return fail({ message: 'Ficheiro não encontrado' })
          if (objectUrls.has(path)) URL.revokeObjectURL(objectUrls.get(path))
          const url = URL.createObjectURL(new Blob([rows[0].data], { type: rows[0].mime }))
          objectUrls.set(path, url)
          return { data: { signedUrl: url }, error: null }
        } catch (e) { return fail(e) }
      },
      // Como no Supabase: devolve os ficheiros da pasta e as subpastas (estas com id null).
      async list(prefix = '') {
        try {
          const pg = await db()
          const base = prefix ? `${prefix.replace(/\/$/, '')}/` : ''
          const { rows } = await pg.query(`select path from local.files where path like $1`, [`${base}%`])
          const seen = new Map()
          for (const { path } of rows) {
            const rest = path.slice(base.length)
            const [name, ...more] = rest.split('/')
            if (!seen.has(name)) seen.set(name, { name, id: more.length ? null : path })
          }
          return { data: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)), error: null }
        } catch (e) { return fail(e) }
      },
      async remove(paths) {
        try {
          const pg = await db()
          for (const p of paths) await pg.query(`delete from local.files where path = $1`, [p])
          return { data: [], error: null }
        } catch (e) { return fail(e) }
      },
    }),
  }

  // Sem tempo real: no modo local só há um dispositivo.
  const channel = () => {
    const ch = { on: () => ch, subscribe: cb => { cb?.('SUBSCRIBED'); return ch } }
    return ch
  }

  // Equivalente local da função do Netlify criar-utilizador (mesmas validações).
  const admin = {
    async createUser(input) {
      try {
        const pg = await db()
        const me = currentSession()?.user
        const { rows: r } = await pg.query(`select role from public.profiles where id = $1`, [me?.id || null])
        if (r[0]?.role !== 'admin') return { error: 'Só uma administradora pode criar contas.' }
        const { value, error } = validateNewUser(input)
        if (error) return { error }
        const exists = await pg.query(`select 1 from auth.users where lower(email) = $1`, [value.email])
        if (exists.rows.length) return { error: friendlyCreateError('already registered') }
        const profile = await pg.transaction(async tx => {
          const { rows } = await tx.query(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, $2) returning id`, [value.email, JSON.stringify({ nome: value.nome })])
          const id = rows[0].id
          if (value.modo === 'password') await tx.query(`insert into local.passwords (user_id, hash) values ($1, crypt($2, gen_salt('bf')))`, [id, value.password])
          const res = await tx.query(`with p as (update public.profiles set role = $2, nome = $3 where id = $1 returning *) select row_to_json(p) as j from p`, [id, value.role, value.nome])
          return res.rows[0].j
        })
        return { profile, convite: value.modo === 'convite' }
      } catch (e) {
        return { error: e.message }
      }
    },
  }

  return { local: true, auth, admin, from: table => new Query(table), rpc, storage: storageApi, channel, removeChannel: () => {}, ready: db }
}

// Apaga a base local deste navegador; na próxima abertura é recriada com os dados originais.
export function resetLocalDatabase() {
  return new Promise(resolve => {
    try { localStorage.removeItem(SESSION_KEY) } catch { /* ignorar */ }
    const req = indexedDB.deleteDatabase(`/pglite/${LOCAL_DB_NAME}`)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
