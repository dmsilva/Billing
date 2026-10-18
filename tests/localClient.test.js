import { describe, expect, it } from 'vitest'
import { createLocalClient, selectList } from '../src/local/localClient'
import expected from '../src/data/legacyExpected.json'
import { sumBy } from '../src/lib/money'

const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }

describe('modo local', () => {
  it('traduz embeds do PostgREST', () => {
    expect(selectList('invoices', '*, invoice_files(id, mime)')).toContain("json_build_object('id', e.\"id\", 'mime', e.\"mime\")")
    expect(() => selectList('invoices', 'x; drop table y')).toThrow()
  })

  it('carrega os dados reais, aplica o RLS e grava como no Supabase', async () => {
    const sb = createLocalClient({ dataDir: 'memory://', storage: memoryStorage() })
    const anon = await sb.from('cash_closes').select('*')
    expect(anon.data).toEqual([])

    expect((await sb.auth.signInWithPassword({ email: 'outra@pessoa.pt', password: 'x' })).error).toBeTruthy()
    await sb.auth.signInWithPassword({ email: 'admin@local', password: 'x' })
    const closes = await sb.from('cash_closes').select('*').order('data').order('id').range(0, 999)
    expect(closes.error).toBeNull()
    expect(closes.data.length).toBe(expected.cashCloses.count)
    const bank = await sb.from('bank_transactions').select('*')
    expect(sumBy(bank.data, t => t.valor)).toBeCloseTo(expected.bank.total, 2)
    const inv = await sb.from('invoices').select('*, invoice_files(id, nome_ficheiro)').eq('origem', 'legado')
    expect(inv.data.length).toBe(expected.cashInvoices.count)
    expect(inv.data[0].invoice_files).toEqual([])

    const cat = await sb.from('categories').insert({ nome: 'Teste local' }).select().single()
    expect(cat.data.nome).toBe('Teste local')
    const upd = await sb.from('categories').update({ conta_como_despesa: false }).eq('id', cat.data.id).select().single()
    expect(upd.data.conta_como_despesa).toBe(false)

    const close = closes.data[0]
    const chk = await sb.from('cash_checks').upsert({ cash_close_id: close.id, tipo: 'cv', valor_esperado: 10, valor_real: 8 }, { onConflict: 'cash_close_id,tipo' }).select().single()
    expect(chk.data.diferenca).toBe(-2)
    const hist = await sb.from('cash_check_history').select('*').eq('cash_close_id', close.id)
    expect(hist.data.length).toBe(1)

    const imp = await sb.rpc('import_cash_closes', { p_rows: [{ data: close.data, turno: close.turno, dinheiro: 1, cv: 2, mb: 3, city_mb: 0 }], p_file: 'teste.xlsx', p_origem: 'excel' })
    expect(imp.error).toBeNull()
    const undo = await sb.rpc('undo_cash_import', { p_import_id: imp.data })
    expect(undo.error).toBeNull()
    const back = await sb.from('cash_closes').select('dinheiro').eq('id', close.id).single()
    expect(back.data.dinheiro).toBe(close.dinheiro)

    const del = await sb.from('cash_checks').delete().in('id', [chk.data.id])
    expect(del.error).toBeNull()

    const created = await sb.admin.createUser({ email: 'Ana@Exemplo.pt', nome: 'Ana', role: 'rececao', modo: 'password', password: 'segredo123' })
    expect(created.error).toBeUndefined()
    expect(created.profile).toMatchObject({ email: 'ana@exemplo.pt', nome: 'Ana', role: 'rececao' })
    expect((await sb.admin.createUser({ email: 'ana@exemplo.pt', role: 'rececao', modo: 'password', password: 'segredo123' })).error).toMatch(/Já existe/)

    await sb.auth.signOut()
    expect((await sb.auth.signInWithPassword({ email: 'ana@exemplo.pt', password: 'errada' })).error).toBeTruthy()
    expect((await sb.auth.signInWithPassword({ email: 'ana@exemplo.pt', password: 'segredo123' })).error).toBeNull()
    expect((await sb.from('profiles').select('role').single()).data.role).toBe('rececao')
    expect((await sb.admin.createUser({ email: 'z@z.pt', role: 'admin', modo: 'convite' })).error).toMatch(/administradora/)
    await sb.auth.signOut()
    await sb.auth.signInWithPassword({ email: 'rececao@local', password: 'x' })
    expect((await sb.from('bank_transactions').select('*')).data).toEqual([])
    const props = await sb.from('properties').select('id, nome').eq('ativo', true)
    expect(props.data.length).toBeGreaterThan(0)
  }, 60000)
})
