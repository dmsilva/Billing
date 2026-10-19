import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../supabase'
import { ACCEPTED, uploadInvoiceFile, validateFile } from '../data/files'
import { parseMoney } from '../lib/money'
import { formatDate, formatDateTime, todayIso } from '../lib/dates'

// Página independente para a receção: fotografar/enviar faturas. Não mostra dados financeiros.
export default function Rececao() {
  const { user, profile, signOut, isAdmin } = useAuth()
  const [properties, setProperties] = useState([])
  const [mine, setMine] = useState([])
  const blank = () => ({ fornecedor: '', data: todayIso(), imovel_id: '', pagamento: 'Numerário', enviado_por: profile?.nome || '', documento: '', valor: '', observacoes: '' })
  const [form, setForm] = useState(blank)
  const [files, setFiles] = useState([])
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  async function loadMine() {
    const { data } = await supabase.from('invoices').select('id, fornecedor, data, pagamento, estado, created_at, invoice_files(id)').eq('submitted_by', user.id).order('created_at', { ascending: false }).limit(10)
    setMine(data || [])
  }

  useEffect(() => {
    supabase.from('properties').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => {
      setProperties(data || [])
      setForm(f => ({ ...f, imovel_id: f.imovel_id || data?.[0]?.id || '' }))
    })
    loadMine()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const previews = useMemo(() => files.map(f => ({ f, url: f.type.startsWith('image/') && !/heic|heif/.test(f.type) ? URL.createObjectURL(f) : null })), [files])
  useEffect(() => () => previews.forEach(p => p.url && URL.revokeObjectURL(p.url)), [previews])

  function pick(list) {
    const arr = [...list]
    const errors = arr.map(validateFile).filter(Boolean)
    setStatus(errors.length ? { tone: 'bad', text: errors.join(' ') } : null)
    setFiles(prev => [...prev, ...arr.filter(f => !validateFile(f))])
  }

  async function send(e) {
    e.preventDefault()
    setStatus(null)
    if (!files.length) return setStatus({ tone: 'bad', text: 'Adiciona pelo menos uma foto ou PDF da fatura.' })
    const valor = form.valor.trim() ? parseMoney(form.valor) : null
    if (form.valor.trim() && valor === null) return setStatus({ tone: 'bad', text: 'O valor não é válido. Usa, por exemplo, 12,30' })
    setBusy(true)
    try {
      const { data: inv, error } = await supabase.from('invoices').insert({
        fornecedor: form.fornecedor.trim() || null, data: form.data || null, imovel_id: form.imovel_id ? Number(form.imovel_id) : null,
        pagamento: form.pagamento, enviado_por: form.enviado_por.trim() || null, documento: form.documento.trim() || null,
        valor, observacoes: form.observacoes.trim() || null, origem: 'rececao', estado: 'Por validar', submitted_by: user.id,
      }).select('id').single()
      if (error) throw error
      let sent = 0
      const failed = []
      for (const file of files) {
        try { await uploadInvoiceFile({ file, invoiceId: inv.id, userId: user.id }); sent++ } catch (err) { failed.push(`${file.name} (${err.message})`) }
      }
      if (failed.length) setStatus({ tone: 'bad', text: `A fatura ficou registada, mas ${failed.length} ficheiro(s) não foram enviados: ${failed.join(', ')}. Avisa a administradora.` })
      else setStatus({ tone: 'ok', text: `✓ Fatura enviada com ${sent} ficheiro(s). Já está disponível na aplicação principal para validação.` })
      setForm(f => ({ ...blank(), imovel_id: f.imovel_id, pagamento: f.pagamento, enviado_por: f.enviado_por }))
      setFiles([])
      if (fileRef.current) fileRef.current.value = ''
      loadMine()
    } catch (err) {
      setStatus({ tone: 'bad', text: `Não foi possível enviar: ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  const set = patch => setForm(f => ({ ...f, ...patch }))
  return (
    <div className="rececao">
      <div className="wrap">
        <div className="rec-top">
          <div><div className="rec-brand">Fatura<span>Claro</span></div><div className="sub">Envio de faturas · Receção</div></div>
          <div className="rec-user">{profile?.nome || profile?.email}<br />{isAdmin && <a href="/">Abrir aplicação</a>} <button className="link-btn" onClick={signOut}>Sair</button></div>
        </div>
        <form className="panel" onSubmit={send}>
          <h2>Enviar fatura</h2>
          <div className="small">Fotografa a fatura ou recibo, escolhe como foi pago e envia. O original fica arquivado em segurança para validação.</div>
          <label className="drop big">
            <input ref={fileRef} type="file" accept={ACCEPTED} multiple capture="environment" onChange={e => pick(e.target.files)} />
            <strong>📷 Tirar foto ou escolher ficheiro</strong>
            <span className="small">Podes juntar várias fotos da mesma fatura (até 20 MB cada).</span>
          </label>
          {files.length > 0 && (
            <div className="preview">
              {previews.map(({ f, url }, i) => (
                <div key={i} className="thumb">
                  {url ? <img src={url} alt={f.name} /> : <div className="file-icon">{f.type === 'application/pdf' ? 'PDF' : '📄'}</div>}
                  <span>{f.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remover">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="grid">
            <label>Fornecedor<input value={form.fornecedor} onChange={e => set({ fornecedor: e.target.value })} placeholder="Ex.: Pingo Doce" /></label>
            <label>Data da fatura<input type="date" value={form.data} onChange={e => set({ data: e.target.value })} /></label>
          </div>
          <label>Imóvel<select value={form.imovel_id} onChange={e => set({ imovel_id: e.target.value })}>{properties.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
          <label>Meio de pagamento</label>
          <div className="pay">
            {['Numerário', 'CGD'].map(p => (
              <label key={p}><input type="radio" name="pay" value={p} checked={form.pagamento === p} onChange={() => set({ pagamento: p })} /><span>{p === 'Numerário' ? '💶 Numerário' : '🏦 CGD'}</span></label>
            ))}
          </div>
          <div className="grid">
            <label>Quem está a enviar?<input value={form.enviado_por} onChange={e => set({ enviado_por: e.target.value })} placeholder="Nome do funcionário" /></label>
            <label>Valor total <span className="opt">(opcional)</span><input inputMode="decimal" value={form.valor} onChange={e => set({ valor: e.target.value })} placeholder="0,00" /></label>
          </div>
          <label>Documento / nº fatura <span className="opt">(opcional)</span><input value={form.documento} onChange={e => set({ documento: e.target.value })} placeholder="Ex.: FT 2026/1234" /></label>
          <label>Observações <span className="opt">(opcional)</span><textarea value={form.observacoes} onChange={e => set({ observacoes: e.target.value })} placeholder="Alguma informação importante…" /></label>
          <button className="btn" disabled={busy}>{busy ? 'A enviar…' : 'Enviar fatura'}</button>
          {status && <div className={status.tone === 'ok' ? 'ok' : 'err'}>{status.text}</div>}
        </form>
        {mine.length > 0 && (
          <div className="panel mine">
            <h3>Os meus últimos envios</h3>
            {mine.map(i => (
              <div className="mine-row" key={i.id}>
                <span>{formatDate(i.data)}</span><strong>{i.fornecedor || 'Sem fornecedor'}</strong><span>{i.pagamento}</span><span>📎 {i.invoice_files?.length || 0}</span><span className={`badge ${i.estado === 'Validada' ? 'ok' : i.estado === 'Rejeitada' ? 'bad' : 'pending'}`}>{i.estado}</span>
                <small>{formatDateTime(i.created_at)}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
