import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../supabase'
import { useMonthOptions } from '../components/FilterBar'
import InvoiceTable, { exportInvoices } from '../components/InvoiceTable'
import { Kpi, Panel, Select, useToast } from '../components/ui'
import { invoiceCountsAsExpense, PAYMENT_CASH } from '../lib/finance'
import { euro, sumBy } from '../lib/money'
import { monthLabel, monthOf } from '../lib/dates'
import { printExpenseReport } from '../lib/expenseReport'
import { PayModal } from './PorLiquidar'
import { BULK_ACTIONS, bulkPatch, matchesInvoice } from '../lib/invoiceBulk'

const INVOICE_SELECT = '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)'

// Separadores: o que falta confirmar, o que já bate certo, o numerário e tudo.
export const TABS = {
  'por-confirmar': { label: 'Por confirmar', test: r => r.estado === 'Por validar' },
  conferidas: { label: 'Conferidas', test: r => r.estado === 'Validada' },
  'por-liquidar': { label: 'Por liquidar', test: r => r.pagamento === 'Por pagar' && r.estado !== 'Rejeitada' },
  numerario: { label: 'Numerário', test: r => r.pagamento === PAYMENT_CASH && r.estado !== 'Rejeitada' },
  todas: { label: 'Todas', test: () => true },
}

// Todas as faturas numa só página: as da receção, as manuais e as migradas.
export default function Faturas() {
  const { invoiceRows, invoices, bank_transactions, invoice_payments, paymentsReady, upsertLocal, reload } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'por-confirmar'
  const months = useMonthOptions()
  const [month, setMonth] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [action, setAction] = useState('validar')
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState('recentes')
  const [origem, setOrigem] = useState('')
  const [paying, setPaying] = useState(null)

  const base = useMemo(() => invoiceRows.filter(r => (!month || monthOf(r.data) === month) && (!origem || (origem === 'rececao') === (r.source.origem === 'rececao')) && matchesInvoice(r, q)), [invoiceRows, month, origem, q])
  const counts = useMemo(() => Object.fromEntries(Object.entries(TABS).map(([k, t]) => [k, base.filter(t.test).length])), [base])
  const rows = useMemo(
    () => base.filter(TABS[tab].test).sort((a, b) => (order === 'antigas' ? -1 : 1) * (String(b.data).localeCompare(String(a.data)) || String(b.source.created_at).localeCompare(String(a.source.created_at)))),
    [base, tab, order],
  )
  const chosen = rows.filter(r => selected.has(r.id))
  const cash = rows.filter(r => invoiceCountsAsExpense(r.source))
  const linked = rows.filter(r => r.source.bank_transaction_id || r.source.payment_id)

  const onSelect = (ids, on) => setSelected(s => {
    const n = new Set(s)
    for (const id of ids) (on ? n.add(id) : n.delete(id))
    return n
  })

  async function apply() {
    setBusy(true)
    const skipped = []
    const groups = new Map()
    for (const r of chosen) {
      const { patch, skip } = bulkPatch(r.source, action, { userId: user?.id })
      if (skip) { skipped.push(`${r.fornecedor || 'Sem fornecedor'} (${skip})`); continue }
      const k = JSON.stringify(patch)
      groups.set(k, { patch, ids: [...(groups.get(k)?.ids || []), r.id] })
    }
    let done = 0
    for (const { patch, ids } of groups.values()) {
      const { data, error } = await supabase.from('invoices').update(patch).in('id', ids).select(INVOICE_SELECT)
      if (error) { setBusy(false); return toast(`Não foi possível gravar: ${error.message}`, 'bad') }
      upsertLocal('invoices', data)
      done += data.length
    }
    setBusy(false)
    setSelected(new Set())
    toast(`${done} fatura${done === 1 ? '' : 's'} alterada${done === 1 ? '' : 's'}.${skipped.length ? ` Ficaram como estavam: ${skipped.join(', ')}.` : ''}`)
  }

  // Liquidar a partir daqui: as faturas passam primeiro a "Por pagar" e depois entram num pagamento,
  // como em Por liquidar. Ficam de fora as já ligadas ao extrato, já liquidadas, rejeitadas ou sem valor.
  function startPay() {
    const ok = chosen.filter(r => !r.source.bank_transaction_id && !r.source.payment_id && r.estado !== 'Rejeitada' && r.valor != null)
    const left = chosen.length - ok.length
    if (!ok.length) return toast('Nenhuma das selecionadas pode ser liquidada (já ligadas ao extrato, já liquidadas, rejeitadas ou sem valor).', 'bad')
    if (left) toast(`${left} das selecionadas ficam de fora (já ligadas ao extrato, já liquidadas, rejeitadas ou sem valor).`)
    setPaying(ok.map(r => r.source))
  }
  const toUnpaid = paying?.filter(i => i.pagamento !== 'Por pagar') || []
  async function prepareUnpaid() {
    if (!toUnpaid.length) return null
    const { data, error } = await supabase.from('invoices').update({ pagamento: 'Por pagar', bank_transaction_id: null, liquidada_em: null }).in('id', toUnpaid.map(i => i.id)).select(INVOICE_SELECT)
    if (error) return `Não foi possível preparar as faturas: ${error.message}`
    upsertLocal('invoices', data)
    return null
  }
  async function rollbackUnpaid() {
    for (const i of toUnpaid) {
      const { data } = await supabase.from('invoices').update({ pagamento: i.pagamento, liquidada_em: i.liquidada_em ?? null }).eq('id', i.id).select(INVOICE_SELECT)
      if (data) upsertLocal('invoices', data)
    }
  }

  function pdf() {
    const list = chosen.length ? chosen : rows
    const sub = [month ? monthLabel(month) : 'Todos os meses', TABS[tab].label, origem === 'rececao' ? 'enviadas pela receção' : origem === 'admin' ? 'registadas pela administração' : '', chosen.length ? 'selecionadas' : ''].filter(Boolean).join(' · ')
    if (!printExpenseReport([...list].sort((a, b) => String(a.data).localeCompare(String(b.data))), { title: 'Despesas', subtitle: sub })) toast('O navegador bloqueou a janela do PDF. Autoriza janelas pop-up para este site.', 'bad')
  }

  return (
    <>
      <Panel
        title="Faturas"
        hint="Todas as faturas num só sítio. As que a receção envia são conferidas com o extrato CGD automaticamente: se houver uma saída com o mesmo valor perto da data, ficam ligadas e passam a Conferidas. As restantes ficam em Por confirmar até as abrires e validares (ou ligares ao movimento certo)."
      >
        <div className="tabs" role="tablist">
          {Object.entries(TABS).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setSelected(new Set()); setParams(k === 'por-confirmar' ? {} : { tab: k }) }}>
              {t.label} <span className="tab-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="filters flat">
          <input className="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar fornecedor, documento, descrição ou valor…" aria-label="Pesquisar faturas" />
          <Select value={month} onChange={setMonth} options={months} placeholder="Todos os meses" aria-label="Mês" />
          <Select value={origem} onChange={setOrigem} options={[{ value: 'rececao', label: 'Enviadas pela receção' }, { value: 'admin', label: 'Registadas pela administração' }]} placeholder="Todas as origens" aria-label="Origem" />
          <Select value={order} onChange={v => setOrder(v || 'recentes')} options={[{ value: 'recentes', label: 'Data: mais recentes primeiro' }, { value: 'antigas', label: 'Data: mais antigas primeiro' }]} aria-label="Ordenar" />
          <button type="button" className="secondary" onClick={pdf} title="Relatório com as faturas visíveis (ou as selecionadas) e o total de cada mês">PDF das despesas</button>
          <button type="button" className="secondary" onClick={() => exportInvoices(rows, `faturas-${tab}.csv`)}>Exportar CSV</button>
        </div>
        <div className="notice">Os pagamentos Endesa com CPE <strong>PT0002000133379727RQ</strong> pertencem ao <strong>Chalet do Lago</strong>. Confirma o imóvel desses movimentos em CGD / Extrato.</div>
        <div className="notice">Link para a receção: <a href="/rececao" target="_blank" rel="noreferrer">{window.location.origin}/rececao</a> (é preciso entrar com uma conta de receção).</div>
      </Panel>
      <div className="grid4">
        <Kpi color="blue" icon="▧" label={TABS[tab].label} value={rows.length} note={euro(sumBy(rows.filter(r => r.estado !== 'Rejeitada'), r => r.valor))} />
        <Kpi color="purple" icon="▤" label="Ligadas ao extrato" value={linked.length} note="Contam pelo movimento CGD" />
        <Kpi color="green" icon="€" label="Numerário (contabilístico)" value={euro(sumBy(cash, r => r.valor))} note={`${cash.length} fatura(s) · entram nas despesas`} />
        <Kpi color="orange" icon="%" label="IVA" value={euro(sumBy(rows.filter(r => r.source.iva != null), r => r.source.iva))} note={`${rows.filter(r => r.source.iva == null).length} com IVA a apurar`} />
      </div>
      <Panel>
        {chosen.length > 0 && (
          <div className="bulk-bar">
            <strong>{chosen.length} selecionada{chosen.length === 1 ? '' : 's'}</strong>
            <Select value={action} onChange={setAction} options={Object.entries(BULK_ACTIONS).map(([value, label]) => ({ value, label }))} aria-label="Ação" />
            <button type="button" className="primary" disabled={busy} onClick={apply}>{busy ? 'A gravar…' : 'Aplicar'}</button>
            <button type="button" className="primary" disabled={!paymentsReady} onClick={startPay}>Liquidar selecionadas</button>
            <button type="button" className="secondary" onClick={pdf}>PDF das selecionadas</button>
            <button type="button" className="secondary" onClick={() => setSelected(new Set())}>Limpar seleção</button>
          </div>
        )}
        <InvoiceTable rows={rows} showOrigin selected={selected} onSelect={onSelect} />
      </Panel>
      {paying && <PayModal invoices={paying} total={sumBy(paying, i => i.valor)} transactions={bank_transactions} payments={invoice_payments} allInvoices={invoices}
        prepare={prepareUnpaid} rollback={rollbackUnpaid}
        onClose={() => setPaying(null)} onDone={() => { setSelected(new Set()); reload('invoices'); reload('invoice_payments') }} />}
    </>
  )
}
