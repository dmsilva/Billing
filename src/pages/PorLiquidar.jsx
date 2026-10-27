import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import { ConfirmButton, Empty, Kpi, Modal, Panel, useToast } from '../components/ui'
import { unpaidBySupplier } from '../lib/finance'
import { euro, sameAmount, sumBy } from '../lib/money'
import { daysBetween, formatDate, todayIso } from '../lib/dates'
import { summaryHtml, summaryText, supplierSummary } from '../lib/supplierSummary'
import { ACCEPTED, deletePaymentProofs, listPaymentProofs, paymentsWithProof, signedUrl, uploadPaymentProof, validateFile } from '../data/files'

// Faturas registadas como "Por pagar" (normalmente pela receção) e os pagamentos que as liquidaram.
export default function PorLiquidar() {
  const { invoices, invoice_payments, bank_transactions, propertiesById, paymentsReady, reload } = useData()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [paying, setPaying] = useState(false)
  const [summary, setSummary] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const toggleOpen = id => setOpen(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const [withProof, setWithProof] = useState(() => new Set())
  const loadProofs = useCallback(() => { paymentsWithProof().then(setWithProof).catch(() => {}) }, [])
  useEffect(loadProofs, [loadProofs])

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    return unpaidBySupplier(invoices).filter(g => !term || g.nome.toLowerCase().includes(term) || g.faturas.some(i => String(i.documento || '').toLowerCase().includes(term)))
  }, [invoices, q])
  const all = groups.flatMap(g => g.faturas)
  const chosen = all.filter(i => selected.has(i.id))
  const chosenTotal = sumBy(chosen, i => i.valor)

  const toggle = ids => setSelected(prev => {
    const next = new Set(prev)
    const allOn = ids.every(id => next.has(id))
    for (const id of ids) allOn ? next.delete(id) : next.add(id)
    return next
  })

  const invoicesByPayment = useMemo(() => {
    const m = new Map()
    for (const i of invoices) if (i.payment_id) m.set(i.payment_id, [...(m.get(i.payment_id) || []), i])
    return m
  }, [invoices])

  async function undo(p) {
    const { data, error } = await supabase.rpc('anular_pagamento', { p_payment_id: p.id })
    if (error) return toast(`Não foi possível anular: ${error.message}`, 'bad')
    await deletePaymentProofs(p.id).catch(() => {})
    loadProofs()
    toast(`Pagamento anulado: ${data.faturas} fatura(s) voltaram a ficar por pagar.`)
    reload('invoices')
    reload('invoice_payments')
  }

  return (
    <>
      <Panel title="Faturas por liquidar" hint="Faturas registadas como “Por pagar”. Escolhe as que pagaste (por exemplo, todas as do mês de um fornecedor) e regista um único pagamento. Enquanto estão por pagar não entram nos totais; depois de liquidadas contam como CGD ou Numerário, conforme o pagamento.">
        {!paymentsReady && <div className="notice bad">Para usar esta página é preciso executar uma vez o ficheiro <strong>supabase/05_faturas_por_pagar.sql</strong> no SQL Editor do Supabase.</div>}
        <div className="filters flat">
          <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar fornecedor ou nº do documento…" />
          {selected.size > 0 && <button className="secondary" onClick={() => setSelected(new Set())}>Limpar seleção</button>}
        </div>
      </Panel>
      <div className="grid3">
        <Kpi color="orange" icon="🕓" label="Por liquidar" value={euro(sumBy(all, i => i.valor))} note={`${all.length} fatura(s)`} />
        <Kpi color="blue" icon="▧" label="Fornecedores" value={groups.length} note="Com faturas por pagar" />
        <Kpi color="purple" icon="✓" label="Selecionadas" value={euro(chosenTotal)} note={`${chosen.length} fatura(s)`} />
      </div>

      {groups.length ? groups.map(g => {
        const ids = g.faturas.map(i => i.id)
        const allOn = ids.every(id => selected.has(id))
        return (
          <Panel key={g.nome} title={g.nome} hint={`${g.faturas.length} fatura(s) · ${euro(g.total)}${g.semValor ? ` · ${g.semValor} sem valor` : ''}`}
            actions={<button className="secondary" onClick={() => toggle(ids)}>{allOn ? 'Desmarcar todas' : 'Selecionar todas'}</button>}>
            <div className="tablewrap">
              <table className="mini-table">
                <thead><tr><th /><th>Data</th><th>Documento</th><th>Descrição</th><th>Imóvel</th><th>Estado</th><th className="money">Valor</th></tr></thead>
                <tbody>{g.faturas.map(i => (
                  <tr key={i.id} className={selected.has(i.id) ? 'row-selected' : ''}>
                    <td><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle([i.id])} aria-label="Selecionar fatura" /></td>
                    <td>{formatDate(i.data)}</td>
                    <td><Link to={`/faturas/${i.id}`}>{i.documento || 'Abrir'}</Link></td>
                    <td className="wrap">{i.descricao}</td>
                    <td>{propertiesById.get(i.imovel_id) || '—'}</td>
                    <td>{i.estado}</td>
                    <td className="money">{i.valor == null ? <span className="muted">sem valor</span> : euro(i.valor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        )
      }) : <Panel><div className="emptybox">{q ? 'Nenhuma fatura por pagar para esta pesquisa.' : 'Não há faturas por liquidar.'}</div></Panel>}

      {chosen.length > 0 && (
        <div className="pay-bar">
          <span><strong>{chosen.length}</strong> fatura(s) selecionada(s) · <strong>{euro(chosenTotal)}</strong></span>
          <button className="secondary" onClick={() => setSummary(true)}>Resumo para o fornecedor</button>
          <button className="primary" disabled={!paymentsReady} onClick={() => setPaying(true)}>Liquidar selecionadas</button>
        </div>
      )}

      <Panel title="Pagamentos registados" hint="Cada pagamento junta uma ou mais faturas: carrega no número de faturas para ver quais. Anular volta a pô-las por pagar.">
        {invoice_payments.length ? (
          <div className="tablewrap">
            <table className="mini-table">
              <thead><tr><th>Data</th><th>Fornecedor</th><th>Meio</th><th>Referência</th><th>Comprovativo</th><th className="money">Faturas</th><th className="money">Valor</th><th /></tr></thead>
              <tbody>{[...invoice_payments].sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id).map(p => {
                const linked = [...(invoicesByPayment.get(p.id) || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)))
                const isOpen = open.has(p.id)
                return <Fragment key={p.id}>
                <tr className={isOpen ? 'row-selected' : ''}>
                  <td>{formatDate(p.data)}</td><td>{p.fornecedor || 'Vários'}</td><td>{p.meio}</td><td>{p.referencia || '—'}</td>
                  <td><ProofCell paymentId={p.id} has={withProof.has(p.id)} onChange={loadProofs} /></td>
                  <td className="money"><button type="button" className="link-btn" onClick={() => toggleOpen(p.id)} aria-expanded={isOpen}>{linked.length} {isOpen ? '▴' : '▾'}</button></td><td className="money"><strong>{euro(p.valor)}</strong></td>
                  <td><ConfirmButton className="link-btn" confirmText="Anular pagamento" onConfirm={() => undo(p)}>Anular</ConfirmButton></td>
                </tr>
                {isOpen && (
                  <tr className="payment-invoices"><td colSpan={8}>
                    {linked.length ? (
                      <table className="mini-table">
                        <thead><tr><th>Data</th><th>Nº fatura</th><th>Fornecedor</th><th>Descrição</th><th className="money">Valor</th></tr></thead>
                        <tbody>{linked.map(i => (
                          <tr key={i.id}>
                            <td>{formatDate(i.data)}</td>
                            <td><Link to={`/faturas/${i.id}`}>{i.documento || 'Abrir'}</Link></td>
                            <td>{i.fornecedor || '—'}</td>
                            <td className="wrap">{i.descricao}</td>
                            <td className="money">{i.valor == null ? '—' : euro(i.valor)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    ) : <span className="muted small">Nenhuma fatura ligada a este pagamento.</span>}
                  </td></tr>
                )}
                </Fragment>
              })}</tbody>
            </table>
          </div>
        ) : <Empty>Ainda não há pagamentos registados.</Empty>}
      </Panel>

      {summary && <SummaryModal invoices={chosen} onClose={() => setSummary(false)} />}
      {paying && <PayModal invoices={chosen} total={chosenTotal} transactions={bank_transactions} payments={invoice_payments} allInvoices={invoices}
        onClose={() => setPaying(false)} onDone={() => { setSelected(new Set()); reload('invoices'); reload('invoice_payments'); loadProofs() }} />}
    </>
  )
}

function PayModal({ invoices, total, transactions, payments, allInvoices, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ data: todayIso(), meio: 'CGD', referencia: '', observacoes: '', bank_transaction_id: null })
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState(null)
  const semValor = invoices.filter(i => i.valor == null).length
  const used = useMemo(() => new Set([...payments.map(p => p.bank_transaction_id), ...allInvoices.map(i => i.bank_transaction_id)].filter(Boolean)), [payments, allInvoices])
  // Movimentos do extrato com o mesmo valor do pagamento, mais próximos da data primeiro.
  const candidates = useMemo(() => transactions
    .filter(t => !used.has(t.id) && sameAmount(Math.abs(Number(t.valor)), total))
    .sort((a, b) => Math.abs(daysBetween(f.data, a.data_mov)) - Math.abs(daysBetween(f.data, b.data_mov)))
    .slice(0, 6), [transactions, used, total, f.data])

  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('liquidar_faturas', {
      p_ids: invoices.map(i => i.id), p_data: f.data, p_meio: f.meio, p_referencia: f.referencia, p_observacoes: f.observacoes,
      p_bank_transaction_id: f.meio === 'CGD' ? f.bank_transaction_id : null,
    })
    if (error) { setBusy(false); return toast(`Não foi possível liquidar: ${error.message}`, 'bad') }
    let proofFailed = false
    if (proof) await uploadPaymentProof({ file: proof, paymentId: data.pagamento }).catch(() => { proofFailed = true })
    setBusy(false)
    toast(`Pagamento registado: ${data.faturas} fatura(s), ${euro(data.valor)}.`)
    if (proofFailed) toast('O comprovativo não foi guardado. Junta-o outra vez em “Pagamentos registados”.', 'bad')
    onDone()
    onClose()
  }

  return (
    <Modal title={`Liquidar ${invoices.length} fatura(s) · ${euro(total)}`} onClose={onClose}>
      {semValor > 0 && <div className="notice bad">{semValor} fatura(s) não têm valor. Abre-as e preenche o valor antes de liquidar.</div>}
      <div className="form-grid">
        <label>Data do pagamento<input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></label>
        <label>Meio de pagamento
          <div className="pay-toggle two">
            {['CGD', 'Numerário'].map(m => <button type="button" key={m} className={f.meio === m ? 'on' : ''} onClick={() => setF({ ...f, meio: m })}>{m === 'CGD' ? '🏦 CGD' : '💶 Numerário'}</button>)}
          </div>
        </label>
        <label className="span2">Referência <span className="opt">(opcional)</span><input value={f.referencia} onChange={e => setF({ ...f, referencia: e.target.value })} placeholder="Ex.: Transferência outubro" /></label>
        <label className="span2">Observações <span className="opt">(opcional)</span><input value={f.observacoes} onChange={e => setF({ ...f, observacoes: e.target.value })} /></label>
        <label className="span2">Comprovativo de pagamento <span className="opt">(opcional, PDF ou foto)</span>
          <input type="file" accept={ACCEPTED} onChange={e => {
            const file = e.target.files?.[0] || null
            const err = file && validateFile(file)
            if (err) { toast(err, 'bad'); e.target.value = ''; return setProof(null) }
            setProof(file)
          }} />
        </label>
      </div>
      {f.meio === 'CGD' && (
        <div className="bank-link">
          <div className="subhead">Movimento do extrato CGD <span className="opt">(opcional)</span></div>
          {candidates.length ? candidates.map(t => (
            <button type="button" key={t.id} className={`candidate ${f.bank_transaction_id === t.id ? 'on' : ''}`} onClick={() => setF({ ...f, bank_transaction_id: f.bank_transaction_id === t.id ? null : t.id })}>
              <span>{formatDate(t.data_mov)}</span><span>{t.descricao}</span><strong>{euro(t.valor)}</strong>
            </button>
          )) : <div className="muted small">Ainda não há no extrato um movimento de {euro(total)}. Podes liquidar na mesma; quando importares o extrato, o movimento aparece em CGD / Extrato.</div>}
        </div>
      )}
      <p className="muted small">{f.meio === 'CGD'
        ? 'Pagas por CGD: o valor conta pelo movimento do extrato, por isso as faturas não somam outra vez.'
        : `Pagas em numerário: ${euro(total)} entram nas despesas contabilísticas.`}</p>
      <div className="actions end">
        <button className="secondary" onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={busy || semValor > 0 || !f.data} onClick={save}>{busy ? 'A registar…' : 'Registar pagamento'}</button>
      </div>
    </Modal>
  )
}

// Comprovativo de um pagamento já registado: ver o que existe ou juntar um novo.
function ProofCell({ paymentId, has, onChange }) {
  const toast = useToast()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!has) return setFiles([])
    let alive = true
    listPaymentProofs(paymentId)
      .then(list => Promise.all(list.map(async f => ({ ...f, url: await signedUrl(f.path).catch(() => null) }))))
      .then(list => alive && setFiles(list))
      .catch(() => {})
    return () => { alive = false }
  }, [paymentId, has])

  async function add(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateFile(file)
    if (err) return toast(err, 'bad')
    setBusy(true)
    try {
      await uploadPaymentProof({ file, paymentId })
      toast('Comprovativo guardado.')
      onChange()
    } catch (x) {
      toast(`Não foi possível guardar o comprovativo: ${x.message}`, 'bad')
    }
    setBusy(false)
  }

  return (
    <span className="proof-cell">
      {files.map(f => f.url && <a key={f.path} href={f.url} target="_blank" rel="noreferrer" title={f.nome}>📎 Ver</a>)}
      <label className="link-btn">{busy ? 'A guardar…' : has ? '+ Outro' : '+ Juntar'}<input type="file" accept={ACCEPTED} hidden disabled={busy} onChange={add} /></label>
    </span>
  )
}

// Resumo das faturas selecionadas para mandar ao fornecedor por email.
function SummaryModal({ invoices, onClose }) {
  const toast = useToast()
  const s = useMemo(() => supplierSummary(invoices), [invoices])
  const text = summaryText(s)
  const subject = `Faturas a pagar${s.groups.length === 1 ? ` — ${s.groups[0].nome}` : ''}`

  async function copy() {
    try {
      if (window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new Blob([summaryHtml(s)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
      } else await navigator.clipboard.writeText(text)
      toast('Resumo copiado. Cola-o no email.')
    } catch {
      toast('Não foi possível copiar automaticamente. Seleciona a tabela e copia à mão.', 'bad')
    }
  }

  return (
    <Modal title={`Resumo para o fornecedor · ${euro(s.total)}`} onClose={onClose}>
      {s.semValor > 0 && <div className="notice bad">{s.semValor} fatura(s) não têm valor: aparecem como “sem valor” e não entram no total.</div>}
      <div className="supplier-summary">
        {s.groups.map(g => (
          <div key={g.nome}>
            {s.groups.length > 1 && <div className="subhead">{g.nome}</div>}
            <table className="mini-table">
              <thead><tr><th>Data</th><th>Nº fatura</th><th className="money">Valor</th></tr></thead>
              <tbody>
                {g.linhas.map(l => <tr key={l.id}><td>{formatDate(l.data)}</td><td>{l.documento || '—'}</td><td className="money">{l.valor == null ? 'sem valor' : euro(l.valor)}</td></tr>)}
                <tr className="total-row"><td colSpan={2}><strong>Total</strong></td><td className="money"><strong>{euro(g.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        ))}
        {s.groups.length > 1 && <div className="breakfast-total"><span>Total geral</span><strong>{euro(s.total)}</strong></div>}
      </div>
      <p className="muted small">“Copiar” guarda a tabela para colares no email (no Gmail e no Outlook fica com as linhas da tabela). “Abrir email” abre um email novo já com o resumo em texto.</p>
      <div className="actions end">
        <button className="secondary" onClick={onClose}>Fechar</button>
        <a className="secondary btn-link" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Bom dia,\n\nSeguem as faturas que vamos pagar:\n\n${text}\n\nCumprimentos`)}`}>Abrir email</a>
        <button className="primary" onClick={copy}>Copiar resumo</button>
      </div>
    </Modal>
  )
}
