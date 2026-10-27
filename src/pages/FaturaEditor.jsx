import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import CategorySelect from '../components/CategorySelect'
import { Badge, ConfirmButton, Panel, Select, StateBadge, useToast } from '../components/ui'
import { ACCEPTED, deleteInvoiceFile, listPaymentProofs, signedUrl, uploadInvoiceFile, validateFile } from '../data/files'
import { euro, euroExact, parseMoney, sameAmount, sumBy } from '../lib/money'
import { daysBetween, formatDate, formatDateTime, todayIso } from '../lib/dates'
import { invoiceCountsAsExpense } from '../lib/finance'

const PRODUCT_TYPES = ['Pequeno-almoço', 'Laticínios', 'Fruta', 'Fruta/legumes', 'Bebidas', 'Mercearia', 'Limpeza', 'Consumíveis', 'Alimentação', 'Outros']
const PAY_LABEL = { 'Numerário': '💶 Numerário', CGD: '🏦 CGD', 'Por pagar': '🕓 Por pagar' }
const toInput = v => (v === null || v === undefined ? '' : String(v).replace('.', ','))

function blank(propertyId) {
  return { data: todayIso(), fornecedor: '', documento: '', descricao: '', categoria_id: null, imovel_id: propertyId, pagamento: 'Numerário', valor: '', iva: '', iva_estado: 'A apurar', estado: 'Por validar', observacoes: '', bank_transaction_id: null, origem: 'manual' }
}

export default function FaturaEditor() {
  const { id } = useParams()
  const isNew = !id
  const nav = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { invoices, invoice_lines, bank_transactions, properties, upsertLocal, removeLocal, reload } = useData()
  const invoice = invoices.find(i => String(i.id) === id)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setForm(null), [id])

  useEffect(() => {
    if (isNew) setForm(f => f || blank(properties[0]?.id ?? null))
    else if (invoice && !form) setForm({ ...invoice, valor: toInput(invoice.valor), iva: toInput(invoice.iva) })
  }, [isNew, invoice, properties, form])

  if (!isNew && !invoice) return <Panel><div className="emptybox">Fatura não encontrada. <Link to="/faturas">Voltar às faturas</Link></div></Panel>
  if (!form) return null

  const set = patch => setForm(f => ({ ...f, ...patch }))
  const valor = parseMoney(form.valor)
  const iva = parseMoney(form.iva)

  function payload(extra = {}) {
    const p = {
      data: form.data || null, fornecedor: form.fornecedor.trim() || null, documento: form.documento?.trim() || null, descricao: form.descricao?.trim() || null,
      categoria_id: form.categoria_id, imovel_id: form.imovel_id ? Number(form.imovel_id) : null, pagamento: form.pagamento,
      valor: form.valor === '' ? null : valor, iva: form.iva === '' ? null : iva, iva_estado: form.iva_estado, estado: form.estado,
      observacoes: form.observacoes?.trim() || null, motivo_rejeicao: form.motivo_rejeicao || null,
      bank_transaction_id: form.pagamento === 'CGD' ? form.bank_transaction_id : null,
      ...extra,
    }
    // Marcar à mão como paga (ou voltar a por pagar) regista a data da liquidação.
    const wasUnpaid = isNew ? false : invoice.pagamento === 'Por pagar'
    if (wasUnpaid && form.pagamento !== 'Por pagar') p.liquidada_em = todayIso()
    if (!wasUnpaid && form.pagamento === 'Por pagar' && !isNew) p.liquidada_em = null
    if (isNew) p.origem = 'manual'
    return p
  }

  async function save(extra = {}, message = 'Fatura guardada.') {
    if (form.valor !== '' && valor === null) return toast('Valor inválido. Usa, por exemplo, 123,45', 'bad')
    if (form.iva !== '' && iva === null) return toast('IVA inválido.', 'bad')
    setBusy(true)
    const p = payload(extra)
    const q = isNew ? supabase.from('invoices').insert(p) : supabase.from('invoices').update(p).eq('id', invoice.id)
    const { data, error } = await q.select('*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)').single()
    setBusy(false)
    if (error) return toast(`Não foi possível guardar: ${error.message}`, 'bad')
    upsertLocal('invoices', data)
    setForm({ ...data, valor: toInput(data.valor), iva: toInput(data.iva) })
    toast(message)
    if (isNew) nav(`/faturas/${data.id}`, { replace: true })
  }

  async function remove() {
    for (const f of invoice.invoice_files || []) await deleteInvoiceFile(f).catch(() => {})
    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id)
    if (error) return toast(`Não foi possível eliminar: ${error.message}`, 'bad')
    removeLocal('invoices', invoice.id)
    reload('invoice_lines')
    toast('Fatura eliminada.')
    nav('/faturas')
  }

  const linked = bank_transactions.find(t => t.id === form.bank_transaction_id)
  return (
    <div className="editor">
      <div className="editor-head">
        <Link to={-1} onClick={e => { e.preventDefault(); nav(-1) }} className="link-btn">← Voltar</Link>
        <div className="actions">
          {!isNew && <StateBadge value={form.estado} />}
          {!isNew && <Badge>{form.origem === 'rececao' ? `Enviada pela receção${form.enviado_por ? ` · ${form.enviado_por}` : ''}` : form.origem === 'legado' ? 'Migrada do legado' : 'Registo manual'}</Badge>}
        </div>
      </div>

      <div className="twocol">
        <Panel title={isNew ? 'Nova fatura' : `Fatura ${form.documento || ''}`} hint={!isNew ? `Registada em ${formatDateTime(invoice.created_at)}` : 'Regista o documento e depois junta o original e as linhas de produtos.'}>
          <div className="form-grid">
            <label>Fornecedor<input value={form.fornecedor || ''} onChange={e => set({ fornecedor: e.target.value })} placeholder="Ex.: Pingo Doce" /></label>
            <label>Data da fatura<input type="date" value={form.data || ''} onChange={e => set({ data: e.target.value })} /></label>
            <label>Documento / nº<input value={form.documento || ''} onChange={e => set({ documento: e.target.value })} placeholder="Ex.: FT 2026/1234" /></label>
            <label>Imóvel<Select value={form.imovel_id ?? ''} onChange={v => set({ imovel_id: v ? Number(v) : null })} options={properties.map(p => ({ value: p.id, label: p.nome }))} placeholder="Sem imóvel" /></label>
            <label className="span2">Descrição<input value={form.descricao || ''} onChange={e => set({ descricao: e.target.value })} /></label>
            <label>Categoria<CategorySelect className="" value={form.categoria_id} onChange={v => set({ categoria_id: v })} /></label>
            <label>Meio de pagamento
              <div className="pay-toggle">
                {['Numerário', 'CGD', 'Por pagar'].map(p => <button type="button" key={p} disabled={!!form.payment_id} className={form.pagamento === p ? 'on' : ''} onClick={() => set({ pagamento: p })}>{PAY_LABEL[p]}</button>)}
              </div>
            </label>
            <label>Valor total (€)<input inputMode="decimal" value={form.valor} onChange={e => set({ valor: e.target.value })} placeholder="0,00" /></label>
            <label>IVA (€)<input inputMode="decimal" value={form.iva} onChange={e => set({ iva: e.target.value })} placeholder="opcional" /></label>
            <label>Estado do IVA<Select value={form.iva_estado} onChange={v => set({ iva_estado: v })} options={['A apurar', 'Apurado', 'Isento']} /></label>
            <label>Estado<Select value={form.estado} onChange={v => set({ estado: v })} options={['Por validar', 'Validada', 'Rejeitada']} /></label>
            {form.estado === 'Rejeitada' && <label className="span2">Motivo da rejeição<input value={form.motivo_rejeicao || ''} onChange={e => set({ motivo_rejeicao: e.target.value })} /></label>}
            <label className="span2">Observações<textarea value={form.observacoes || ''} onChange={e => set({ observacoes: e.target.value })} /></label>
          </div>
          <div className={`notice ${form.pagamento === 'CGD' ? '' : form.pagamento === 'Por pagar' ? 'warn' : 'ok'}`}>
            {form.payment_id
              ? <>Liquidada em {formatDate(form.liquidada_em)} num pagamento agrupado. Para mudar o meio de pagamento, anula esse pagamento em <Link to="/por-liquidar">Por liquidar</Link>. <PaymentProofLinks paymentId={form.payment_id} /></>
              : form.pagamento === 'Por pagar'
              ? <>Por pagar: ainda não entra nos totais. Liquida-a em <Link to="/por-liquidar">Por liquidar</Link> (sozinha ou junto com outras do mesmo fornecedor).</>
              : form.pagamento === 'CGD'
              ? 'Paga por CGD: o valor já está no extrato bancário, por isso esta fatura não soma outra vez. Liga-a ao movimento correspondente.'
              : invoiceCountsAsExpense({ ...form, valor: form.valor === '' ? null : valor })
                ? `Paga em numerário: ${euro(valor)} entram nas despesas contabilísticas (não saem da CGD).`
                : 'Paga em numerário: só entra nos totais quando tiver valor e não estiver rejeitada.'}
          </div>
          {form.pagamento === 'CGD' && <BankLink form={form} set={set} transactions={bank_transactions} invoices={invoices} valor={valor} linked={linked} />}
          <div className="actions end">
            {!isNew && <ConfirmButton className="secondary danger-text" confirmText="Eliminar fatura e ficheiros" onConfirm={remove}>Eliminar</ConfirmButton>}
            {!isNew && form.estado !== 'Rejeitada' && <button className="secondary" disabled={busy} onClick={() => save({ estado: 'Rejeitada', validated_by: user.id, validated_at: new Date().toISOString() }, 'Fatura rejeitada.')}>Rejeitar</button>}
            {!isNew && form.estado !== 'Validada' && <button className="secondary" disabled={busy || valor === null} title={valor === null ? 'Indica o valor antes de validar' : ''} onClick={() => save({ estado: 'Validada', validated_by: user.id, validated_at: new Date().toISOString() }, 'Fatura validada.')}>✓ Validar</button>}
            <button className="primary" disabled={busy} onClick={() => save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
          </div>
        </Panel>
        {isNew ? <Panel title="Documento original"><div className="emptybox">Guarda a fatura para poderes juntar fotografias ou PDF.</div></Panel> : <FilesPanel invoice={invoice} userId={user.id} />}
      </div>
      {!isNew && <LinesPanel invoice={invoice} lines={invoice_lines.filter(l => l.invoice_id === invoice.id)} valor={valor} />}
    </div>
  )
}

function BankLink({ form, set, transactions, invoices, valor, linked }) {
  const [q, setQ] = useState('')
  const used = new Set(invoices.filter(i => i.bank_transaction_id && i.id !== form.id).map(i => i.bank_transaction_id))
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase()
    return transactions
      .filter(t => !used.has(t.id))
      .map(t => ({ t, score: (valor != null && sameAmount(t.valor, valor) ? 0 : 1) + (form.data ? Math.min(Math.abs(daysBetween(form.data, t.data_mov)), 60) / 60 : 0.5) }))
      .filter(({ t }) => (term ? `${t.descricao} ${t.valor}`.toLowerCase().includes(term) : valor != null && sameAmount(t.valor, valor)))
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
  }, [transactions, valor, form.data, q]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bank-link">
      <div className="subhead">Movimento do extrato CGD</div>
      {linked ? (
        <div className="linked">✓ {formatDate(linked.data_mov)} · {linked.descricao} · <strong>{euro(linked.valor)}</strong> <button className="link-btn" onClick={() => set({ bank_transaction_id: null })}>Desligar</button></div>
      ) : (
        <>
          <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Procurar movimento por descrição ou valor…" />
          {candidates.length ? candidates.map(({ t }) => (
            <button type="button" key={t.id} className="candidate" onClick={() => set({ bank_transaction_id: t.id })}>
              <span>{formatDate(t.data_mov)}</span><span>{t.descricao}</span><strong>{euro(t.valor)}</strong>
            </button>
          )) : <div className="muted small">{valor != null ? 'Nenhum movimento com este valor. Procura pela descrição.' : 'Indica o valor ou procura pela descrição.'}</div>}
        </>
      )}
    </div>
  )
}

function FilesPanel({ invoice, userId }) {
  const toast = useToast()
  const { upsertLocal, reload } = useData()
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)
  const files = invoice.invoice_files || []

  useEffect(() => {
    let alive = true
    Promise.all(files.map(async f => [f.id, await signedUrl(f.storage_path).catch(() => null)])).then(e => alive && setUrls(Object.fromEntries(e)))
    return () => { alive = false }
  }, [files.map(f => f.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(list) {
    const errors = [...list].map(validateFile).filter(Boolean)
    if (errors.length) return toast(errors.join(' '), 'bad')
    setBusy(true)
    try {
      const added = []
      for (const file of list) added.push(await uploadInvoiceFile({ file, invoiceId: invoice.id, userId }))
      upsertLocal('invoices', { ...invoice, invoice_files: [...files, ...added] })
      toast(`${added.length} ficheiro(s) guardado(s).`)
    } catch (e) {
      toast(`Erro ao enviar: ${e.message}`, 'bad')
      reload('invoices')
    } finally {
      setBusy(false)
    }
  }

  async function remove(f) {
    try {
      await deleteInvoiceFile(f)
      upsertLocal('invoices', { ...invoice, invoice_files: files.filter(x => x.id !== f.id) })
    } catch (e) {
      toast(`Erro ao remover: ${e.message}`, 'bad')
    }
  }

  return (
    <Panel title="Documento original" hint="Ficheiros guardados de forma privada no Supabase Storage. Os links abrem durante 1 hora.">
      <div className="files">
        {files.length ? files.map(f => (
          <div className="file-card" key={f.id}>
            {f.mime?.startsWith('image/') && urls[f.id] && !/heic|heif/.test(f.mime) ? <a href={urls[f.id]} target="_blank" rel="noreferrer"><img src={urls[f.id]} alt={f.nome_ficheiro} /></a> : <div className="file-icon">{f.mime === 'application/pdf' ? 'PDF' : '📄'}</div>}
            <div className="file-meta">
              <strong title={f.nome_ficheiro}>{f.nome_ficheiro}</strong>
              <span>{formatDateTime(f.created_at)}{f.tamanho ? ` · ${Math.round(f.tamanho / 1024)} KB` : ''}</span>
              <span className="actions">
                {urls[f.id] && <a className="link-btn" href={urls[f.id]} target="_blank" rel="noreferrer">Abrir</a>}
                <ConfirmButton className="link-btn danger-text" confirmText="Remover ficheiro" onConfirm={() => remove(f)}>Remover</ConfirmButton>
              </span>
            </div>
          </div>
        )) : <div className="emptybox">Ainda não há ficheiros. {invoice.origem === 'legado' && 'Os documentos do legado não tinham o original anexado.'}</div>}
      </div>
      <label className="drop">
        <input type="file" accept={ACCEPTED} multiple disabled={busy} onChange={e => { add([...e.target.files]); e.target.value = '' }} />
        <strong>{busy ? 'A enviar…' : '📎 Juntar fotografia ou PDF'}</strong>
        <span className="muted small">Até 20 MB por ficheiro.</span>
      </label>
    </Panel>
  )
}

function LinesPanel({ invoice, lines, valor }) {
  const toast = useToast()
  const { upsertLocal, removeLocal } = useData()
  const [draft, setDraft] = useState({ produto: '', unidade: 'un', quantidade: '', valor: '', tipo: 'Outros' })
  const total = sumBy(lines.filter(l => l.valor != null), l => l.valor)

  async function add(e) {
    e.preventDefault()
    if (!draft.produto.trim()) return
    const q = draft.quantidade === '' ? null : parseMoney(draft.quantidade)
    const v = draft.valor === '' ? null : parseMoney(draft.valor)
    if ((draft.quantidade !== '' && q === null) || (draft.valor !== '' && v === null)) return toast('Quantidade ou valor inválido.', 'bad')
    const { data, error } = await supabase.from('invoice_lines').insert({
      invoice_id: invoice.id, produto: draft.produto.trim(), unidade: draft.unidade || null, quantidade: q, valor: v, tipo: draft.tipo, fornecedor: invoice.fornecedor, data: invoice.data,
    }).select().single()
    if (error) return toast(`Erro: ${error.message}`, 'bad')
    upsertLocal('invoice_lines', data)
    setDraft({ ...draft, produto: '', quantidade: '', valor: '' })
  }

  async function update(line, patch) {
    const { data, error } = await supabase.from('invoice_lines').update(patch).eq('id', line.id).select().single()
    if (error) return toast(`Erro: ${error.message}`, 'bad')
    upsertLocal('invoice_lines', data)
  }

  async function remove(line) {
    const { error } = await supabase.from('invoice_lines').delete().eq('id', line.id)
    if (error) return toast(`Erro: ${error.message}`, 'bad')
    removeLocal('invoice_lines', line.id)
  }

  return (
    <Panel title="Linhas de produtos" hint="Artigos desta fatura. Alimentam a análise por produto e o pequeno-almoço." actions={valor != null && lines.length > 0 && (sameAmount(total, valor) ? <Badge tone="ok">Linhas = total da fatura</Badge> : <Badge tone="pending">Linhas {euro(total)} · fatura {euro(valor)}</Badge>)}>
      <div className="tablewrap">
        <table className="mini-table">
          <thead><tr><th>Produto</th><th>Unidade</th><th className="money">Quantidade</th><th className="money">Valor</th><th>Categoria do produto</th><th /></tr></thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td><input className="cell" defaultValue={l.produto} onBlur={e => e.target.value.trim() && e.target.value !== l.produto && update(l, { produto: e.target.value.trim() })} /></td>
                <td><input className="cell short" defaultValue={l.unidade || ''} onBlur={e => e.target.value !== (l.unidade || '') && update(l, { unidade: e.target.value || null })} /></td>
                <td className="money"><input className="cell short num" defaultValue={toInput(l.quantidade)} onBlur={e => { const v = e.target.value === '' ? null : parseMoney(e.target.value); if (v !== null || e.target.value === '') update(l, { quantidade: v }) }} /></td>
                <td className="money"><input className="cell short num" defaultValue={toInput(l.valor)} onBlur={e => { const v = e.target.value === '' ? null : parseMoney(e.target.value); if (v !== null || e.target.value === '') update(l, { valor: v }) }} /></td>
                <td><Select value={l.tipo || 'Outros'} onChange={v => update(l, { tipo: v })} options={[...new Set([...PRODUCT_TYPES, l.tipo].filter(Boolean))]} /></td>
                <td><ConfirmButton className="link-btn danger-text" confirmText="Remover" onConfirm={() => remove(l)}>✕</ConfirmButton></td>
              </tr>
            ))}
            <tr className="add-row">
              <td><input className="cell" value={draft.produto} onChange={e => setDraft({ ...draft, produto: e.target.value })} placeholder="Novo produto…" onKeyDown={e => e.key === 'Enter' && add(e)} /></td>
              <td><input className="cell short" value={draft.unidade} onChange={e => setDraft({ ...draft, unidade: e.target.value })} /></td>
              <td className="money"><input className="cell short num" inputMode="decimal" value={draft.quantidade} onChange={e => setDraft({ ...draft, quantidade: e.target.value })} onKeyDown={e => e.key === 'Enter' && add(e)} /></td>
              <td className="money"><input className="cell short num" inputMode="decimal" value={draft.valor} onChange={e => setDraft({ ...draft, valor: e.target.value })} onKeyDown={e => e.key === 'Enter' && add(e)} /></td>
              <td><Select value={draft.tipo} onChange={v => setDraft({ ...draft, tipo: v })} options={PRODUCT_TYPES} /></td>
              <td><button className="primary small" onClick={add}>Adicionar</button></td>
            </tr>
          </tbody>
          {lines.length > 0 && <tfoot><tr><td colSpan={3}><strong>Total das linhas</strong></td><td className="money"><strong>{euroExact(total)}</strong></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
    </Panel>
  )
}

// Comprovativo(s) do pagamento agrupado em que a fatura foi liquidada.
function PaymentProofLinks({ paymentId }) {
  const [files, setFiles] = useState([])
  useEffect(() => {
    let alive = true
    listPaymentProofs(paymentId)
      .then(list => Promise.all(list.map(async f => ({ ...f, url: await signedUrl(f.path).catch(() => null) }))))
      .then(list => alive && setFiles(list.filter(f => f.url)))
      .catch(() => {})
    return () => { alive = false }
  }, [paymentId])
  return files.map(f => <a key={f.path} href={f.url} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>📎 Comprovativo de pagamento</a>)
}
