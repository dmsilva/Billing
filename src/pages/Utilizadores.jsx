import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { localMode, supabase } from '../supabase'
import { createUser } from '../data/users'
import { MIN_PASSWORD } from '../lib/users'
import { Empty, Panel, Select, useToast } from '../components/ui'
import { formatDateTime } from '../lib/dates'

const ROLES = [
  { value: 'admin', label: 'Administradora' },
  { value: 'rececao', label: 'Receção' },
  { value: 'pendente', label: 'Sem acesso' },
]

export default function Utilizadores() {
  const { profiles, upsertLocal, reload } = useData()
  const { user } = useAuth()
  const toast = useToast()

  async function update(p, patch) {
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', p.id).select().single()
    if (error) { toast(error.message.includes('administradora') ? 'Tem de existir pelo menos uma administradora.' : error.message, 'bad'); reload('profiles'); return }
    upsertLocal('profiles', data)
    toast('Acesso atualizado.')
  }

  return (
    <>
      <Panel title="Utilizadores" hint="A administradora vê e gere tudo. A receção só tem acesso à página de envio de faturas e vê apenas o que enviou. Podes mudar o papel de cada pessoa a qualquer momento; “Sem acesso” bloqueia a conta.">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Email</th><th>Nome</th><th>Papel</th><th>Criada</th></tr></thead>
            <tbody>
              {profiles.length ? profiles.map(p => (
                <tr key={p.id}>
                  <td>{p.email}{p.id === user.id && <span className="muted"> (tu)</span>}</td>
                  <td><input className="cell" defaultValue={p.nome || ''} onBlur={e => e.target.value !== (p.nome || '') && update(p, { nome: e.target.value })} /></td>
                  <td><Select className="editselect" value={p.role} onChange={v => update(p, { role: v })} options={ROLES} disabled={p.id === user.id} /></td>
                  <td>{formatDateTime(p.created_at)}</td>
                </tr>
              )) : <Empty colSpan={4} />}
            </tbody>
          </table>
        </div>
      </Panel>
      <NewUser onCreated={p => upsertLocal('profiles', p)} />
    </>
  )
}

const EMPTY = { email: '', nome: '', role: 'rececao', modo: localMode ? 'password' : 'convite', password: '' }

function NewUser({ onCreated }) {
  const toast = useToast()
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const set = patch => setF(prev => ({ ...prev, ...patch }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    const res = await createUser(f)
    setBusy(false)
    if (res.error) return toast(res.error, 'bad')
    onCreated(res.profile)
    toast(res.convite ? `Convite enviado para ${res.profile.email}.` : `Conta ${res.profile.email} criada. Já pode entrar.`)
    setF(EMPTY)
  }

  return (
    <Panel title="Criar utilizador" hint="A conta fica logo com o papel escolhido.">
      <form className="new-user" onSubmit={submit}>
        <label>Email<input type="email" required value={f.email} onChange={e => set({ email: e.target.value })} placeholder="nome@exemplo.pt" /></label>
        <label>Nome<input value={f.nome} onChange={e => set({ nome: e.target.value })} placeholder="Ex.: Ana Silva" /></label>
        <label>Papel<Select value={f.role} onChange={v => set({ role: v })} options={ROLES.filter(r => r.value !== 'pendente')} /></label>
        <fieldset className="new-user-mode">
          <legend>Acesso</legend>
          {!localMode && <label className="radio"><input type="radio" checked={f.modo === 'convite'} onChange={() => set({ modo: 'convite' })} /> Enviar convite por email (a pessoa define a palavra-passe)</label>}
          <label className="radio"><input type="radio" checked={f.modo === 'password'} onChange={() => set({ modo: 'password' })} /> Definir já a palavra-passe</label>
          {f.modo === 'password' && <input type="text" autoComplete="new-password" minLength={MIN_PASSWORD} required value={f.password} onChange={e => set({ password: e.target.value })} placeholder={`Pelo menos ${MIN_PASSWORD} caracteres`} />}
        </fieldset>
        <div className="actions"><button className="primary" disabled={busy}>{busy ? 'A criar…' : 'Criar utilizador'}</button></div>
      </form>
      {localMode && <p className="muted small">Modo local: a conta fica só neste navegador. Não são enviados emails.</p>}
    </Panel>
  )
}
