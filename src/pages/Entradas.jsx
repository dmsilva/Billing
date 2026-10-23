import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { useMonthOptions } from '../components/FilterBar'
import { Badge, ConfirmButton, Empty, Kpi, Modal, Panel, Select, useToast } from '../components/ui'
import { bankCredits } from '../lib/finance'
import { CREDIT_TYPES, guessPayer } from '../lib/bankImport'
import { euro, parseMoney } from '../lib/money'
import { formatDate, monthLabel, monthOf, todayIso } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'
import { supabase } from '../supabase'
import { matchesTransfer } from '../lib/transfers'

// Entradas da conta CGD (créditos do extrato) e transferências partilhadas com a receção.
export default function Entradas() {
  const { bank_credits, transferencias, properties, propertiesById, creditsReady, upsertLocal, removeLocal, reload } = useData()
  const { filters, set } = useFilters()
  const toast = useToast()
  const months = useMonthOptions()
  const monthOptions = useMemo(() => {
    const all = new Set([...months.map(m => m.value), ...bank_credits.map(c => monthOf(c.data_mov))])
    return [...all].filter(Boolean).sort().map(v => ({ value: v, label: monthLabel(v) }))
  }, [bank_credits, months])
  const [q, setQ] = useState('')
  const [qc, setQc] = useState('')
  const [editing, setEditing] = useState(null)

  const month = filters.month
  const resumo = bankCredits(bank_credits, month)
  const tipo = t => resumo.porTipo.find(x => x.tipo === t)?.total || 0
  const credits = useMemo(() => bank_credits
    .filter(c => !month || monthOf(c.data_mov) === month)
    .filter(c => !qc.trim() || `${c.descricao} ${c.tipo} ${Number(c.valor).toFixed(2).replace('.', ',')}`.toLowerCase().includes(qc.trim().toLowerCase()))
    .sort((a, b) => String(b.data_mov).localeCompare(String(a.data_mov)) || b.id - a.id), [bank_credits, month, qc])
  const transferByCredit = useMemo(() => new Map(transferencias.filter(t => t.bank_credit_id).map(t => [t.bank_credit_id, t])), [transferencias])
  const transfers = useMemo(() => transferencias
    .filter(t => matchesTransfer(t, q, propertiesById))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id), [transferencias, q, propertiesById])

  async function updateCredit(c, patch) {
    const { data, error } = await supabase.from('bank_credits').update(patch).eq('id', c.id).select().single()
    if (error) return toast(`Não foi possível gravar: ${error.message}`, 'bad')
    upsertLocal('bank_credits', data)
  }

  async function publish(c) {
    const { error } = await supabase.rpc('publicar_transferencia', { p_credit_id: c.id, p_ordenante: guessPayer(c.descricao) })
    if (error) return toast(`Não foi possível enviar: ${error.message}`, 'bad')
    toast('Transferência enviada para a receção.')
    reload('transferencias')
  }

  async function remove(t) {
    const { error } = await supabase.from('transferencias').delete().eq('id', t.id)
    if (error) return toast(`Não foi possível apagar: ${error.message}`, 'bad')
    removeLocal('transferencias', t.id)
  }

  const exportCsv = () => downloadText(toCsv(
    ['Data', 'Descrição', 'Origem', 'Conta como entrada', 'Valor', 'Saldo'],
    credits.map(c => [c.data_mov, c.descricao, c.tipo, c.conta_como_entrada === false ? 'Não' : 'Sim', decimalPt(c.valor), decimalPt(c.saldo)]),
  ), 'entradas_cgd.csv')

  return (
    <>
      {!creditsReady && <div className="notice bad">Para usar esta página é preciso executar uma vez o ficheiro <strong>supabase/06_entradas_transferencias.sql</strong> no SQL Editor do Supabase.</div>}
      <div className="filters">
        <Select value={month} onChange={v => set({ month: v })} options={monthOptions} placeholder="Todos os meses" aria-label="Mês" />
        <button className="secondary" onClick={exportCsv}>Exportar CSV</button>
      </div>
      <div className="grid4">
        <Kpi color="green" icon="↘" label="Entradas no banco" value={euro(resumo.total)} note={`${resumo.count} movimento(s) do extrato`} />
        <Kpi color="blue" icon="✈" label="Plataformas" value={euro(tipo('Expedia') + tipo('Booking') + tipo('Airbnb'))} note="Expedia, Booking, Airbnb (já sem comissões)" />
        <Kpi color="purple" icon="◆" label="Cartões" value={euro(tipo('TPA / Multibanco') + tipo('Stripe'))} note={`TPA ${euro(tipo('TPA / Multibanco'))} · Stripe ${euro(tipo('Stripe'))}`} />
        <Kpi color="orange" icon="⇄" label="Transferências" value={euro(tipo('Transferência'))} note="De hóspedes e outras" />
      </div>

      <Panel title="Transferências na receção" hint="O que a receção vê na aba “Transferências”. Adiciona uma assim que a vês no banco; quando importares o extrato, a entrada com o mesmo valor fica ligada automaticamente."
        actions={<button className="primary" disabled={!creditsReady} onClick={() => setEditing({})}>+ Adicionar transferência</button>}>
        <div className="filters flat"><input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar nome, valor ou reserva…" /></div>
        <div className="tablewrap tall">
          <table className="mini-table">
            <thead><tr><th>Data</th><th>Ordenante</th><th>Imóvel</th><th>Reserva</th><th>Estado</th><th>Extrato</th><th className="money">Valor</th><th /></tr></thead>
            <tbody>
              {transfers.length ? transfers.map(t => (
                <tr key={t.id}>
                  <td>{formatDate(t.data)}</td>
                  <td className="wrap">{t.ordenante || t.descricao || '—'}{t.notas && <div className="muted small">{t.notas}</div>}</td>
                  <td>{propertiesById.get(t.imovel_id) || '—'}</td>
                  <td>{t.reserva || '—'}</td>
                  <td><Badge tone={t.alocada_em ? 'ok' : 'pending'}>{t.alocada_em ? 'Alocada' : 'Por alocar'}</Badge></td>
                  <td>{t.bank_credit_id ? '✓ No extrato' : <span className="muted">À espera</span>}</td>
                  <td className="money"><strong>{euro(t.valor)}</strong></td>
                  <td className="nowrap">
                    <button className="link-btn" onClick={() => setEditing(t)}>Editar</button>{' '}
                    <ConfirmButton className="link-btn" confirmText="Apagar" onConfirm={() => remove(t)}>Apagar</ConfirmButton>
                  </td>
                </tr>
              )) : <Empty colSpan={8}>{q ? 'Nenhuma transferência para esta pesquisa.' : 'Ainda não há transferências na receção.'}</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Entradas da conta CGD" hint="Créditos do extrato, importados em CGD / Extrato. Contam como entradas, nunca como despesa. Desmarca “Conta” nos que não são receita (por exemplo, dinheiro entre contas próprias).">
        <div className="filters flat"><input className="search" value={qc} onChange={e => setQc(e.target.value)} placeholder="Pesquisar descrição, origem ou valor…" /></div>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Origem</th><th>Conta</th><th>Receção</th><th className="money">Valor</th></tr></thead>
            <tbody>
              {credits.length ? credits.map(c => {
                const t = transferByCredit.get(c.id)
                return (
                  <tr key={c.id} className={c.conta_como_entrada === false ? 'row-muted' : ''}>
                    <td>{formatDate(c.data_mov)}</td>
                    <td className="wrap">{c.descricao}</td>
                    <td><select className="inline-select" value={c.tipo} onChange={e => updateCredit(c, { tipo: e.target.value })} aria-label="Origem">{CREDIT_TYPES.map(x => <option key={x}>{x}</option>)}</select></td>
                    <td><input type="checkbox" checked={c.conta_como_entrada !== false} onChange={e => updateCredit(c, { conta_como_entrada: e.target.checked })} aria-label="Conta como entrada" /></td>
                    <td>{t ? <Badge tone={t.alocada_em ? 'ok' : 'pending'}>{t.alocada_em ? 'Alocada' : 'Na receção'}</Badge> : <button className="link-btn" onClick={() => publish(c)}>Enviar para a receção</button>}</td>
                    <td className="money"><strong>{euro(c.valor)}</strong></td>
                  </tr>
                )
              }) : <Empty colSpan={6}>{creditsReady ? 'Sem entradas neste período. Importa o extrato em CGD / Extrato.' : 'Ainda não há entradas.'}</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>

      {editing && <TransferModal transfer={editing} properties={properties} onClose={() => setEditing(null)} onSaved={row => { upsertLocal('transferencias', row); setEditing(null) }} />}
    </>
  )
}

function TransferModal({ transfer, properties, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    data: transfer.data || todayIso(), valor: transfer.valor == null ? '' : String(transfer.valor).replace('.', ','), ordenante: transfer.ordenante || '',
    imovel_id: transfer.imovel_id || '', reserva: transfer.reserva || '', notas: transfer.notas || '',
  }))
  const [busy, setBusy] = useState(false)
  const set = patch => setF(x => ({ ...x, ...patch }))

  async function save() {
    const valor = parseMoney(f.valor)
    if (!valor || valor <= 0) return toast('Indica um valor válido, por exemplo 120,00', 'bad')
    const alocada = Boolean(f.imovel_id || f.reserva.trim())
    const row = {
      data: f.data, valor, ordenante: f.ordenante.trim() || null, imovel_id: f.imovel_id ? Number(f.imovel_id) : null,
      quarto: null, reserva: f.reserva.trim() || null, notas: f.notas.trim() || null,
    }
    if (alocada && !transfer.alocada_em) Object.assign(row, { alocada_em: new Date().toISOString(), alocada_por: (await supabase.auth.getUser()).data.user?.id || null })
    if (!alocada) Object.assign(row, { alocada_em: null, alocada_por: null })
    setBusy(true)
    const q = transfer.id ? supabase.from('transferencias').update(row).eq('id', transfer.id) : supabase.from('transferencias').insert(row)
    const { data, error } = await q.select().single()
    setBusy(false)
    if (error) return toast(`Não foi possível gravar: ${error.message}`, 'bad')
    toast(transfer.id ? 'Transferência atualizada.' : 'Transferência adicionada. A receção já a vê.')
    onSaved(data)
  }

  return (
    <Modal title={transfer.id ? 'Editar transferência' : 'Nova transferência recebida'} onClose={onClose}>
      <div className="form-grid">
        <label>Data<input type="date" value={f.data} onChange={e => set({ data: e.target.value })} /></label>
        <label>Valor<input inputMode="decimal" value={f.valor} onChange={e => set({ valor: e.target.value })} placeholder="0,00" /></label>
        <label className="span2">Ordenante<input value={f.ordenante} onChange={e => set({ ordenante: e.target.value })} placeholder="Nome de quem transferiu" /></label>
        <label className="span2">Imóvel <span className="opt">(opcional)</span>
          <select value={f.imovel_id} onChange={e => set({ imovel_id: e.target.value })}><option value="">—</option>{properties.filter(p => p.ativo !== false).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        </label>
        <label className="span2">Reserva <span className="opt">(opcional)</span><input value={f.reserva} onChange={e => set({ reserva: e.target.value })} placeholder="Nº ou nome da reserva" /></label>
        <label className="span2">Notas <span className="opt">(opcional)</span><input value={f.notas} onChange={e => set({ notas: e.target.value })} /></label>
      </div>
      {transfer.descricao && <p className="muted small">No banco: {transfer.descricao}</p>}
      <div className="actions end">
        <button className="secondary" onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={busy || !f.data} onClick={save}>{busy ? 'A gravar…' : 'Gravar'}</button>
      </div>
    </Modal>
  )
}
