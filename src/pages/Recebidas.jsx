import { useMemo, useState } from 'react'
import { useData } from '../data/DataProvider'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../supabase'
import InvoiceTable from '../components/InvoiceTable'
import { Panel, Select, useToast } from '../components/ui'
import { BULK_ACTIONS, bulkPatch, matchesInvoice } from '../lib/invoiceBulk'

const INVOICE_SELECT = '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)'

export default function Recebidas() {
  const { invoiceRows, upsertLocal } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const [estado, setEstado] = useState('Por validar')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [action, setAction] = useState('por-pagar')
  const [busy, setBusy] = useState(false)
  const rows = useMemo(
    () => invoiceRows.filter(r => r.source.origem === 'rececao' && (!estado || r.estado === estado) && matchesInvoice(r, q)).sort((a, b) => String(b.source.created_at).localeCompare(String(a.source.created_at))),
    [invoiceRows, estado, q],
  )
  // Só contam as selecionadas que estão visíveis com os filtros atuais.
  const chosen = rows.filter(r => selected.has(r.id))

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

  return (
    <>
      <Panel
        title="Faturas recebidas da receção"
        hint="Documentos enviados pela página da receção. Abre cada um para ver o original, completar o valor e a categoria e validar. Os documentos antigos continuam nas áreas Faturas e Numerário."
        actions={<Select value={estado} onChange={setEstado} options={['Por validar', 'Validada', 'Rejeitada']} placeholder="Todos os estados" aria-label="Estado" />}
      >
        <div className="notice">Link para a receção: <a href="/rececao" target="_blank" rel="noreferrer">{window.location.origin}/rececao</a> (é preciso entrar com uma conta de receção).</div>
      </Panel>
      <Panel>
        <div className="filters flat">
          <input className="search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar fornecedor, documento, descrição ou valor…" aria-label="Pesquisar faturas recebidas" />
          {q.trim() && <span className="muted small">{rows.length} encontrada{rows.length === 1 ? '' : 's'}</span>}
        </div>
        {chosen.length > 0 && (
          <div className="bulk-bar">
            <strong>{chosen.length} selecionada{chosen.length === 1 ? '' : 's'}</strong>
            <Select value={action} onChange={setAction} options={Object.entries(BULK_ACTIONS).map(([value, label]) => ({ value, label }))} aria-label="Ação" />
            <button type="button" className="primary" disabled={busy} onClick={apply}>{busy ? 'A gravar…' : 'Aplicar'}</button>
            <button type="button" className="secondary" onClick={() => setSelected(new Set())}>Limpar seleção</button>
          </div>
        )}
        <InvoiceTable rows={rows} showOrigin selected={selected} onSelect={onSelect} />
      </Panel>
    </>
  )
}
