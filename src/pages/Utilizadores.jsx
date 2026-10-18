import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
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
      <Panel title="Utilizadores" hint="A administradora vê e gere tudo. A receção só tem acesso à página de envio de faturas e vê apenas o que enviou. Contas novas ficam “sem acesso” até lhes atribuíres um papel.">
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
      <Panel title="Adicionar uma pessoa">
        <ol className="howto">
          <li>No Supabase, abre <strong>Authentication → Users → Invite user</strong> e escreve o email da pessoa.</li>
          <li>A pessoa recebe um email, abre o link e define a palavra-passe nesta aplicação.</li>
          <li>Volta a esta página e escolhe o papel: <strong>Receção</strong> ou <strong>Administradora</strong>.</li>
        </ol>
        <p className="muted small">Criar contas exige a chave de serviço do Supabase, que nunca fica no navegador. Por isso o convite é feito no painel do Supabase.</p>
      </Panel>
    </>
  )
}
