import { useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../supabase'
import { useMonthOptions } from '../components/FilterBar'
import InvoiceTable, { exportInvoices } from '../components/InvoiceTable'
import { Modal, Panel, Select, useToast } from '../components/ui'
import { invoiceCountsAsExpense, PAYMENT_CASH } from '../lib/finance'
import { euro, sumBy } from '../lib/money'
import { monthLabel, monthOf } from '../lib/dates'
import { printExpenseReport, printSimpleReport } from '../lib/expenseReport'
import { PayModal } from './PorLiquidar'
import { BULK_ACTIONS, bulkPatch, matchesInvoice } from '../lib/invoiceBulk'
import { openDroppedInvoices } from '../components/ArrastarFaturas'
import { ACCEPTED, downloadStoredFile, invoiceFileLinks } from '../data/files'
import { buildInvoicesZip } from '../lib/zipFaturas'
import ImprimirFaturas from '../components/ImprimirFaturas'

const INVOICE_SELECT = '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)'

// Separadores: o que falta confirmar, o que já bate certo, o numerário e tudo.
// As faturas por pagar têm a sua própria página (Faturas › Por pagar).
export const TABS = {
  'por-confirmar': { label: 'Por confirmar', test: r => r.estado === 'Por validar' },
  conferidas: { label: 'Conferidas', test: r => r.estado === 'Validada' },
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
  // Por omissão, as últimas que chegaram ficam em cima (a data da fatura pode ser de meses atrás,
  // ex.: as faturas da Airbnb que a receção envia de uma vez).
  const [order, setOrder] = useState('chegada')
  const [origem, setOrigem] = useState('')
  const [paying, setPaying] = useState(null)
  const [zipping, setZipping] = useState(null)
  const [printing, setPrinting] = useState(null)
  const [exportMenu, setExportMenu] = useState(false)

  const base = useMemo(() => invoiceRows.filter(r => (!month || monthOf(r.data) === month) && (!origem || (origem === 'rececao') === (r.source.origem === 'rececao')) && matchesInvoice(r, q)), [invoiceRows, month, origem, q])
  const counts = useMemo(() => Object.fromEntries(Object.entries(TABS).map(([k, t]) => [k, base.filter(t.test).length])), [base])
  const rows = useMemo(
    () => base.filter(TABS[tab].test).sort(order === 'chegada'
      ? (a, b) => String(b.source.created_at).localeCompare(String(a.source.created_at)) || String(b.data).localeCompare(String(a.data))
      : (a, b) => (order === 'antigas' ? -1 : 1) * (String(b.data).localeCompare(String(a.data)) || String(b.source.created_at).localeCompare(String(a.source.created_at)))),
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

  // PDF das despesas: "Completo" (por mês, com fornecedor, categoria, pagamento…) ou
  // "Simplificado" (só Data, Fatura com link e Valor, mais o Total: bom para pagar a um fornecedor).
  async function pdf(kind) {
    const list = [...(chosen.length ? chosen : rows)].sort((a, b) => String(a.data).localeCompare(String(b.data)))
    const sub = [month ? monthLabel(month) : 'Todos os meses', TABS[tab].label, origem === 'rececao' ? 'enviadas pela receção' : origem === 'admin' ? 'registadas pela administração' : '', chosen.length ? 'selecionadas' : ''].filter(Boolean).join(' · ')
    const blocked = () => toast('O navegador bloqueou a janela do PDF. Autoriza janelas pop-up para este site.', 'bad')
    if (kind !== 'simples') return printExpenseReport(list, { title: 'Despesas', subtitle: sub }) || blocked()
    // Se forem todas do mesmo fornecedor, o título é o nome dele (ex.: "Grão de Trigo").
    const forn = [...new Set(list.filter(r => r.estado !== 'Rejeitada').map(r => (r.fornecedor || '').trim()))]
    const title = forn.length === 1 && forn[0] ? forn[0] : 'Despesas'
    const subtitle = month ? monthLabel(month) : ''
    if (!(await printSimpleReport(list, { title, subtitle, getLinks: invoiceFileLinks }))) blocked()
  }

  // Ficheiros originais (PDF/fotos) das selecionadas, ou de todas as visíveis, para a contabilidade:
  // separados num ZIP ou todos juntos num só PDF (escolhe-se na janela que abre).
  // Usado na janela Exportar: só avança se alguma fatura tiver ficheiro.
  function withFiles(next) {
    const list = (chosen.length ? chosen : rows).filter(r => r.source.invoice_files?.length)
    setExportMenu(false)
    if (!list.length) return toast('Nenhuma destas faturas tem ficheiro (PDF ou foto) guardado.', 'bad')
    next(list)
  }
  async function exportFiles(mode) {
    const list = chosen.length ? chosen : rows
    setZipping({ done: 0, total: 0 })
    try {
      const onProgress = (done, total) => setZipping({ done, total })
      const res = mode === 'pdf'
        ? await import('../lib/pdfUnico').then(m => m.buildMergedPdf(list, downloadStoredFile, { onProgress, toJpeg: m.browserToJpeg }))
        : await buildInvoicesZip(list, downloadStoredFile, { onProgress })
      const { count, failed, withoutFiles } = res
      const bytes = mode === 'pdf' ? res.pdf : res.zip
      if (!bytes) return toast('Não foi possível juntar nenhum dos ficheiros.', 'bad')
      const name = `faturas-${month || new Date().toISOString().slice(0, 10)}${chosen.length ? '-selecionadas' : ''}.${mode === 'pdf' ? 'pdf' : 'zip'}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes], { type: mode === 'pdf' ? 'application/pdf' : 'application/zip' }))
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      const names = l => `${l.slice(0, 5).join(', ')}${l.length > 5 ? '…' : ''}`
      const notes = [
        withoutFiles.length ? `${withoutFiles.length} sem ficheiro (${names(withoutFiles.map(r => r.fornecedor || 'Sem fornecedor'))})` : '',
        failed.length ? `${failed.length} ficheiro${failed.length === 1 ? '' : 's'} ficou de fora (${names(failed.map(e => e.row.fornecedor || 'Sem fornecedor'))})` : '',
      ].filter(Boolean).join('; ')
      const what = mode === 'pdf' ? `PDF com ${count} ficheiro${count === 1 ? '' : 's'} descarregado.` : `ZIP com ${count} ficheiro${count === 1 ? '' : 's'} descarregado.`
      toast(`${what}${notes ? ` Atenção: ${notes}.` : ''}`, notes ? 'bad' : 'ok')
    } catch (e) {
      toast(`Não foi possível juntar os ficheiros: ${e.message}`, 'bad')
    } finally {
      setZipping(null)
    }
  }
  const zipLabel = zipping ? `A juntar ${zipping.done}/${zipping.total}…` : null

  // Ações em várias faturas: as do BULK_ACTIONS e "Liquidar" (pagamento agrupado), tudo na mesma lista.
  const actionOptions = [
    { value: 'validar', label: BULK_ACTIONS.validar },
    { value: 'liquidar', label: 'Liquidar (registar pagamento)' },
    ...Object.entries(BULK_ACTIONS).filter(([k]) => k !== 'validar').map(([value, label]) => ({ value, label })),
  ]
  const runAction = () => (action === 'liquidar' ? startPay() : apply())
  const total = sumBy(rows.filter(r => r.estado !== 'Rejeitada'), r => r.valor)
  const iva = sumBy(rows.filter(r => r.source.iva != null), r => r.source.iva)

  if (params.get('tab') === 'por-liquidar') return <Navigate to="/por-liquidar" replace />
  return (
    <>
      <Panel
        title="Faturas"
        hint="As faturas da receção ligam-se sozinhas ao extrato CGD e passam a Conferidas. As restantes ficam em Por confirmar."
        actions={<>
          <label className="button-like secondary" title="PDF ou foto. Também podes arrastar os ficheiros para qualquer sítio desta página.">
            <input type="file" accept={ACCEPTED} multiple hidden onChange={e => { openDroppedInvoices(e.target.files); e.target.value = '' }} />
            📥 Carregar ficheiros
          </label>
          <button type="button" className="secondary" disabled={!!zipping} onClick={() => setExportMenu(true)}>{zipLabel || '⬇ Exportar'}</button>
        </>}
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
          <Select value={order} onChange={v => setOrder(v || 'chegada')} options={[{ value: 'chegada', label: 'Últimas que chegaram primeiro' }, { value: 'recentes', label: 'Data: mais recentes primeiro' }, { value: 'antigas', label: 'Data: mais antigas primeiro' }]} aria-label="Ordenar" />
        </div>

        {chosen.length > 0 ? (
          <div className="bulk-bar">
            <strong>{chosen.length} selecionada{chosen.length === 1 ? '' : 's'}</strong>
            <Select value={action} onChange={v => setAction(v || 'validar')} options={actionOptions} aria-label="Ação" />
            <button type="button" className="primary" disabled={busy || (action === 'liquidar' && !paymentsReady)} onClick={runAction}>{busy ? 'A gravar…' : 'Aplicar'}</button>
            <button type="button" className="secondary" disabled={!!zipping} onClick={() => setExportMenu(true)}>{zipLabel || '⬇ Exportar selecionadas'}</button>
            <button type="button" className="link-button" onClick={() => setSelected(new Set())}>Limpar seleção</button>
          </div>
        ) : (
          <div className="inv-summary">
            <span><b>{rows.length}</b> fatura{rows.length === 1 ? '' : 's'}</span>
            <span>Total <b>{euro(total)}</b></span>
            <span>IVA <b>{euro(iva)}</b></span>
            <span title="Faturas em numerário: entram nas despesas">Numerário <b>{euro(sumBy(cash, r => r.valor))}</b></span>
            <span title="Contam pelo movimento CGD">Ligadas ao extrato <b>{linked.length}</b></span>
          </div>
        )}
        <InvoiceTable rows={rows} showOrigin selected={selected} onSelect={onSelect} />
      </Panel>
      {exportMenu && (
        <Modal title={chosen.length ? `Exportar ${chosen.length} selecionada${chosen.length === 1 ? '' : 's'}` : `Exportar ${rows.length} fatura${rows.length === 1 ? '' : 's'} visíveis`} onClose={() => setExportMenu(false)}>
          <div className="export-group">
            <strong>Lista das despesas (PDF)</strong>
            <div className="actions">
              <button type="button" className="primary" onClick={() => { setExportMenu(false); pdf('completo') }}>Completa</button>
              <button type="button" className="secondary" onClick={() => { setExportMenu(false); pdf('simples') }}>Simplificada</button>
            </div>
            <p className="muted small">Completa: por mês, com fornecedor, descrição, categoria e pagamento. Simplificada: só Data, Fatura (o número abre o ficheiro, link válido 30 dias) e Valor, com o Total. Bom para pagar a um fornecedor (ex.: Grão de Trigo de outubro).</p>
          </div>
          <div className="export-group">
            <strong>Ficheiros das faturas (PDF e fotos)</strong>
            <div className="actions">
              <button type="button" className="primary" onClick={() => withFiles(() => exportFiles('pdf'))}>Todas num só PDF</button>
              <button type="button" className="secondary" onClick={() => withFiles(() => exportFiles('zip'))}>Separadas (ZIP)</button>
              <button type="button" className="secondary" onClick={() => withFiles(list => setPrinting(list))}>🖨 Para imprimir</button>
            </div>
            <p className="muted small">{(chosen.length ? chosen : rows).filter(r => r.source.invoice_files?.length).length} fatura(s) com ficheiro. No PDF único as fotos passam a páginas A4, por data; no ZIP cada fatura fica com data, fornecedor e valor no nome, mais uma lista CSV. Bom para enviar à contabilidade.</p>
          </div>
          <div className="export-group">
            <strong>Excel</strong>
            <div className="actions">
              <button type="button" className="secondary" onClick={() => { setExportMenu(false); exportInvoices(chosen.length ? chosen : rows, `faturas-${tab}.csv`) }}>Exportar CSV</button>
            </div>
          </div>
        </Modal>
      )}
      {printing && <ImprimirFaturas items={printing.map(r => ({ id: r.id, names: [r.fornecedor] }))} onClose={() => setPrinting(null)}
        build={({ pagesById, newSheet, onProgress }) => import('../lib/pdfUnico').then(m => m.buildMergedPdf(printing, downloadStoredFile, { onProgress, newSheet, toJpeg: m.browserToJpeg, pagesFor: e => pagesById[e.row.id] }))} />}
      {paying && <PayModal invoices={paying} total={sumBy(paying, i => i.valor)} transactions={bank_transactions} payments={invoice_payments} allInvoices={invoices}
        prepare={prepareUnpaid} rollback={rollbackUnpaid}
        onClose={() => setPaying(null)} onDone={() => { setSelected(new Set()); reload('invoices'); reload('invoice_payments') }} />}
    </>
  )
}
