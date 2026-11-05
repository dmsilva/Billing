import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { supabase } from '../supabase'
import { ACCEPTED, uploadInvoiceFile, validateFile } from '../data/files'
import { readInvoiceFiles, saveReadLines } from '../data/invoiceReading'
import { scanInvoiceQr } from '../data/qrScan'
import { buildDraft, draftToInvoice, findInvoiceDuplicates } from '../lib/invoiceDrop'
import { fileType } from '../lib/invoiceReading'
import { formatDate, todayIso } from '../lib/dates'
import { euro, parseMoney } from '../lib/money'
import { Modal, useToast } from './ui'

const INVOICE_SELECT = '*, invoice_files(id, nome_ficheiro, mime, storage_path, tamanho, created_at)'
export const OPEN_EVENT = 'fatura-chalet:arrastar-faturas'
const FONTE = { qr: 'QR', ia: 'lido', historico: 'já conhecido' }
const FONTE_TITLE = { qr: 'Tirado do código QR da fatura (o mais fiável)', ia: 'Lido da imagem pela leitura automática: confirma', historico: 'Nome usado nas faturas anteriores com o mesmo NIF' }

// Abre a janela de revisão com ficheiros escolhidos noutro sítio (ex.: botão na página Faturas).
export const openDroppedInvoices = files => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: [...files] }))

const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')

// Arrastar faturas (PDF ou foto) para qualquer página: lê o QR AT e a fatura, mostra os campos
// para rever e grava como "Por pagar" e "Por validar". Nada é gravado sem carregar em Gravar.
export default function ArrastarFaturas({ dropAnywhere = true }) {
  const { user } = useAuth()
  const { invoices, properties, upsertLocal } = useData()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const seq = useRef(0)
  const ctx = useRef({})
  ctx.current = { invoices, properties: properties.filter(p => p.ativo !== false) }

  const patch = (key, p) => setItems(list => list.map(it => (it.key === key ? { ...it, ...(typeof p === 'function' ? p(it) : p) } : it)))

  const process = useCallback(async item => {
    const [qr, read] = await Promise.all([scanInvoiceQr(item.file), readInvoiceFiles([item.file])])
    const draft = buildDraft({ qr, leitura: read.leitura || null, invoices: ctx.current.invoices, properties: ctx.current.properties, today: todayIso() })
    if (read.error && !qr) draft.avisos.unshift(read.error.replace(' Preenche os campos à mão.', ''))
    patch(item.key, { status: 'pronto', draft, linhas: read.leitura?.linhas || [] })
  }, [])

  const add = useCallback(list => {
    const arr = [...list]
    const bad = arr.map(validateFile).filter(Boolean)
    if (bad.length) toast(bad.join(' '), 'bad')
    const ok = arr.filter(f => !validateFile(f)).map(file => ({
      key: ++seq.current, file, status: 'a ler',
      url: URL.createObjectURL(file),
      isImage: fileType(file).startsWith('image/') && !/heic|heif/.test(fileType(file)),
    }))
    if (!ok.length) return
    setItems(cur => [...cur, ...ok])
    // Duas de cada vez, para não esgotar o limite de pedidos da leitura automática.
    const queue = [...ok]
    const worker = async () => { for (let it = queue.shift(); it; it = queue.shift()) await process(it) }
    worker(); worker()
  }, [process, toast])

  useEffect(() => {
    const onOpen = e => add(e.detail || [])
    const enter = e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true) }
    const over = e => { if (hasFiles(e)) e.preventDefault() }
    const leave = e => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) }
    const drop = e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      add(e.dataTransfer.files)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    if (!dropAnywhere) return () => window.removeEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [add, dropAnywhere])

  // Repetidas: contra as faturas gravadas e contra as outras deste lote que ainda não foram gravadas.
  const dupsByKey = useMemo(() => {
    const out = {}
    for (const it of items) {
      if (it.status !== 'pronto') continue
      const others = items.filter(o => o.key < it.key && o.status === 'pronto').map(o => ({
        id: `lote-${o.key}`, lote: o.file.name, fornecedor: o.draft.fornecedor, documento: o.draft.documento, data: o.draft.data,
        valor: parseMoney(o.draft.valor),
        observacoes: [o.draft.nif && `NIF do fornecedor: ${o.draft.nif}`, o.draft.atcud && `ATCUD: ${o.draft.atcud}`].filter(Boolean).join('\n'),
      }))
      out[it.key] = findInvoiceDuplicates(it.draft, [...invoices, ...others])
    }
    return out
  }, [items, invoices])

  async function save(it) {
    const { row, error } = draftToInvoice(it.draft, { userId: user.id })
    if (error) return patch(it.key, { error })
    patch(it.key, { status: 'a gravar', error: null })
    const { data: inv, error: insErr } = await supabase.from('invoices').insert(row).select('id').single()
    if (insErr) return patch(it.key, { status: 'pronto', error: `Não foi possível gravar: ${insErr.message}` })
    // Artigos lidos (manteiga, leite…): se falhar, a fatura fica por ler em Produtos.
    try { await saveReadLines({ id: inv.id, fornecedor: row.fornecedor, data: row.data }, it.linhas) } catch { /* fica por ler */ }
    let fileErr = null
    try { await uploadInvoiceFile({ file: it.file, invoiceId: inv.id, userId: user.id }) } catch (err) { fileErr = err.message }
    const { data: full } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', inv.id).single()
    if (full) upsertLocal('invoices', full)
    patch(it.key, { status: 'gravada', invoiceId: inv.id, error: fileErr ? `A fatura ficou gravada, mas o ficheiro não foi anexado (${fileErr}). Junta-o na fatura.` : null })
  }

  const ready = items.filter(it => it.status === 'pronto')
  // Gravar de uma vez só as completas e sem aviso de repetida; as outras gravam-se uma a uma.
  const safe = ready.filter(it => !(dupsByKey[it.key] || []).length && it.draft.data && it.draft.fornecedor.trim() && it.draft.valor && it.draft.pagamento)
  const pending = items.filter(it => it.status === 'a ler' || it.status === 'a gravar').length

  function close() {
    if (pending) return toast('Espera que termine a leitura ou a gravação.', 'bad')
    if (ready.length && !window.confirm(`Há ${ready.length} fatura(s) por gravar. Fechar e descartar?`)) return
    items.forEach(it => URL.revokeObjectURL(it.url))
    setItems([])
  }
  async function saveAll() { for (const it of safe) await save(it) }

  return (
    <>
      {dragging && <div className="drop-overlay"><div>📥 Larga aqui as faturas (PDF ou foto)<small>A aplicação lê cada uma e mostra os dados para confirmares antes de gravar.</small></div></div>}
      {items.length > 0 && (
        <Modal wide title={`Faturas arrastadas (${items.length})`} onClose={close}>
          <div className="small">As faturas ficam <strong>Por pagar</strong> e <strong>Por validar</strong>; as faturas-recibo e talões ficam já pagas e só tens de dizer como. Confirma os campos e carrega em Gravar. Os valores com <span className="src qr">QR</span> vêm do código QR da fatura; os com <span className="src ia">lido</span> foram lidos da imagem e convém confirmar.</div>
          {items.map(it => (
            <DropCard key={it.key} it={it} dups={dupsByKey[it.key] || []} properties={ctx.current.properties}
              onChange={p => patch(it.key, o => ({ draft: { ...o.draft, ...p, fonte: { ...o.draft.fonte, ...Object.fromEntries(Object.keys(p).map(k => [k, 'manual'])) } } }))}
              onSave={() => save(it)}
              onDiscard={() => { URL.revokeObjectURL(it.url); setItems(list => list.filter(o => o.key !== it.key)) }} />
          ))}
          <div className="drop-foot">
            <span className="small">{pending ? `A tratar ${pending} ficheiro(s)…` : `${items.filter(i => i.status === 'gravada').length} gravada(s) · ${ready.length} por gravar`}</span>
            <label className="drop-more secondary">+ Juntar mais<input type="file" accept={ACCEPTED} multiple onChange={e => { add(e.target.files); e.target.value = '' }} /></label>
            <button type="button" className="primary" disabled={!safe.length} onClick={saveAll} title="Grava as que têm fornecedor, data e valor e não parecem repetidas">Gravar as {safe.length} completas</button>
            <button type="button" className="secondary" onClick={close} disabled={!!pending}>Fechar</button>
          </div>
        </Modal>
      )}
    </>
  )
}

function DropCard({ it, dups, properties, onChange, onSave, onDiscard }) {
  const d = it.draft
  const tag = k => d?.fonte?.[k] && FONTE[d.fonte[k]] ? <span className={`src ${d.fonte[k]}`} title={FONTE_TITLE[d.fonte[k]]}>{FONTE[d.fonte[k]]}</span> : null
  const field = (k, label, props = {}) => (
    <label><span className="lbl">{label} {tag(k)}</span><input value={d[k]} disabled={it.status !== 'pronto'} onChange={e => onChange({ [k]: e.target.value })} {...props} /></label>
  )
  const sure = dups.some(x => x.certeza === 'certo')
  return (
    <div className={`drop-card ${it.status}`}>
      <a className="drop-thumb" href={it.url} target="_blank" rel="noreferrer" title="Abrir o ficheiro">
        {it.isImage ? <img src={it.url} alt="" /> : <span>{fileType(it.file) === 'application/pdf' ? 'PDF' : '📄'}</span>}
        <small>{it.file.name}</small>
      </a>
      <div className="drop-fields">
        {it.status === 'a ler' && <div className="reading busy">A ler a fatura…</div>}
        {d && <>
          {d.tipo && <div className="small"><strong>{d.tipo}</strong>{d.atcud ? ` · ATCUD ${d.atcud}` : ''}</div>}
          <div className="form-grid drop-grid">
            {field('fornecedor', 'Fornecedor', { placeholder: 'Ex.: Pingo Doce' })}
            {field('nif', 'NIF do fornecedor', { inputMode: 'numeric', maxLength: 9 })}
            {field('data', 'Data', { type: 'date' })}
            {field('documento', 'Nº do documento')}
            {field('valor', 'Valor total', { inputMode: 'decimal', placeholder: '0,00' })}
            {field('iva', 'IVA', { inputMode: 'decimal', placeholder: '0,00' })}
            <label>Imóvel<select value={d.imovel_id} disabled={it.status !== 'pronto'} onChange={e => onChange({ imovel_id: e.target.value })}>
              <option value="">Sem imóvel</option>{properties.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select></label>
            <label className={d.pagaNoAto && !d.pagamento ? 'ask' : ''}><span className="lbl">{d.pagaNoAto ? 'Já paga · como?' : 'Pagamento'} {tag('pagamento')}</span><select value={d.pagamento} disabled={it.status !== 'pronto'} onChange={e => onChange({ pagamento: e.target.value })}>
              {!d.pagamento && <option value="">Escolhe como foi paga…</option>}
              <option value="Numerário">💶 Numerário</option><option value="CGD">🏦 Cartão / transferência (CGD)</option><option value="Por pagar">🕓 Ainda por pagar</option>
            </select></label>
          </div>
          <label className="drop-desc"><span className="lbl">O que foi comprado {tag('descricao')}</span><input value={d.descricao} disabled={it.status !== 'pronto'} onChange={e => onChange({ descricao: e.target.value })} /></label>
          {d.pagaNoAto && !d.pagamento && it.status === 'pronto' && <div className="reading ask">É {d.tipo ? d.tipo.toLowerCase() : 'um documento já pago'}: fica como paga. Escolhe se foi em numerário ou por cartão/transferência (CGD).</div>}
          {d.avisos.map((a, i) => <div key={i} className="reading bad">{a}</div>)}
          {dups.length > 0 && it.status !== 'gravada' && (
            <div className={`reading ${sure ? 'dup' : 'bad'}`}>
              {sure ? '⚠ Esta fatura já parece estar registada:' : 'Pode já estar registada:'}
              <ul>{dups.slice(0, 3).map(({ invoice: inv }) => (
                <li key={inv.id}>{inv.lote ? <>Neste lote: {inv.lote}</> : <Link to={`/faturas/${inv.id}`} target="_blank">{inv.fornecedor || 'Sem fornecedor'} · {inv.documento || 'sem nº'} · {formatDate(inv.data)} · {inv.valor == null ? 'sem valor' : euro(inv.valor)} · {inv.pagamento}</Link>}</li>
              ))}</ul>
            </div>
          )}
        </>}
        {it.error && <div className="err">{it.error}</div>}
        <div className="drop-actions">
          {it.status === 'gravada'
            ? <span className="ok">✓ Gravada {d.pagamento === 'Por pagar' ? 'como por pagar' : d.pagamento === 'CGD' ? 'como paga por CGD' : 'como paga em numerário'} · <Link to={`/faturas/${it.invoiceId}`}>abrir</Link></span>
            : <>
              <button type="button" className="primary" disabled={it.status !== 'pronto'} onClick={onSave}>{it.status === 'a gravar' ? 'A gravar…' : dups.length ? 'Gravar mesmo assim' : 'Gravar'}</button>
              <button type="button" className="secondary" disabled={it.status === 'a gravar'} onClick={onDiscard}>{dups.length ? 'Descartar (é repetida)' : 'Descartar'}</button>
            </>}
        </div>
      </div>
    </div>
  )
}
