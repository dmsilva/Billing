import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, localMode } from '../supabase'
import { Panel, useToast, ConfirmButton } from '../components/ui'
import { EMAIL_SAVED_EVENT, openDroppedInvoices } from '../components/ArrastarFaturas'
import { EMAIL_QUEUE_EVENT } from '../components/Layout'
import { EMAIL_SELECT, buildAppsScript, rowToFile, senderName } from '../lib/emailFaturas'
import { formatDate } from '../lib/dates'

const kb = n => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '')
const VIEWS = { pendente: 'Por tratar', gravada: 'Gravadas', ignorada: 'Ignoradas' }

// Faturas que chegam ao email: o programa do Gmail põe-nas nesta fila e daqui abrem no ecrã de revisão.
export default function FaturasEmail() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [view, setView] = useState('pendente')
  const [busy, setBusy] = useState(false)
  const [chave, setChave] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [pagamento, setPagamento] = useState('CGD')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('email_faturas').select(EMAIL_SELECT).order('recebido_em', { ascending: false }).limit(500)
    if (error) { setMissing(true); setRows([]); return }
    setMissing(false)
    setRows(data || [])
    window.dispatchEvent(new CustomEvent(EMAIL_QUEUE_EVENT))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onSaved = () => load()
    window.addEventListener(EMAIL_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(EMAIL_SAVED_EVENT, onSaved)
  }, [load])

  const counts = useMemo(() => Object.fromEntries(Object.keys(VIEWS).map(k => [k, (rows || []).filter(r => r.estado === k).length])), [rows])
  const list = (rows || []).filter(r => r.estado === view)
  const chosen = list.filter(r => sel.has(r.id))
  // Atalhos para escolher de uma vez todas as do mesmo remetente (ex.: todas as da CUR).
  const senders = useMemo(() => {
    const m = new Map()
    for (const r of list) { const k = senderName(r.remetente) || 'Sem remetente'; m.set(k, [...(m.get(k) || []), r.id]) }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [list])
  const toggle = (ids, on) => setSel(cur => { const n = new Set(cur); for (const id of ids) (on ? n.add(id) : n.delete(id)); return n })

  async function review(ids, gravarSozinha = false) {
    if (ids.length > 20) { toast('Escolhe até 20 de cada vez.', 'bad'); return }
    setBusy(true)
    const { data, error } = await supabase.from('email_faturas').select('id, nome_ficheiro, mime, conteudo_b64, remetente, assunto').in('id', ids)
    setBusy(false)
    if (error) return toast(`Não foi possível abrir: ${error.message}`, 'bad')
    const byId = new Map((data || []).map(r => [r.id, r]))
    const files = ids.map(id => byId.get(id)).filter(Boolean).map(rowToFile)
    for (const f of files) Object.assign(f.emailFatura, { pagamento: pagamento || null, gravarSozinha })
    openDroppedInvoices(files)
    setSel(new Set())
  }

  async function open(row) {
    const { data, error } = await supabase.from('email_faturas').select('id, nome_ficheiro, mime, conteudo_b64, remetente, assunto').eq('id', row.id).single()
    if (error) return toast(error.message, 'bad')
    window.open(URL.createObjectURL(rowToFile(data)), '_blank', 'noopener')
  }

  async function setEstado(row, estado) {
    const patch = estado === 'pendente' ? { estado, tratado_em: null } : { estado, tratado_em: new Date().toISOString() }
    const { error } = await supabase.from('email_faturas').update(patch).eq('id', row.id)
    if (error) return toast(error.message, 'bad')
    load()
  }

  return (
    <>
      <Panel
        title="Faturas recebidas por email"
        hint="Os PDFs e fotos de faturas que chegam ao email ficam aqui. Abre-os para rever: a aplicação lê o código QR e a fatura, avisa se já existir, e só grava quando confirmares. As que não são faturas (publicidade, termos…) podes ignorar."
      >
        {missing && <div className="notice warn">Falta executar o <strong>supabase/12_faturas_email.sql</strong> no SQL Editor do Supabase para ativar esta página.</div>}
        <div className="tabs" role="tablist">
          {Object.entries(VIEWS).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {label} <span className="tab-count">{counts[k] || 0}</span>
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="secondary" onClick={load}>↻ Atualizar</button>
        </div>
        {view === 'pendente' && list.length > 0 && (
          <div className="email-bulk">
            <div className="email-chips">
              <span className="small muted">Escolher:</span>
              <button type="button" className="chip" onClick={() => toggle(list.map(r => r.id), chosen.length !== list.length)}>{chosen.length === list.length ? 'Nenhuma' : `Todas (${list.length})`}</button>
              {senders.map(([name, ids]) => (
                <button key={name} type="button" className={`chip ${ids.every(id => sel.has(id)) ? 'on' : ''}`} onClick={() => toggle(ids, !ids.every(id => sel.has(id)))}>{name} ({ids.length})</button>
              ))}
            </div>
            <div className="email-actions">
              <label className="small">Pagamento{' '}
                <select value={pagamento} onChange={e => setPagamento(e.target.value)}>
                  <option value="CGD">🏦 Débito direto / CGD</option>
                  <option value="Por pagar">🕓 Ainda por pagar</option>
                  <option value="">Ver na fatura</option>
                </select>
              </label>
              <button type="button" className="primary" disabled={busy || !chosen.length} onClick={() => review(chosen.map(r => r.id), true)}
                title="Lê cada uma e grava logo as que ficam completas e não estão repetidas; as outras abrem para rever">
                {busy ? 'A abrir…' : `✓ Gravar ${chosen.length || ''} selecionada${chosen.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="secondary" disabled={busy || !chosen.length} onClick={() => review(chosen.map(r => r.id))}>Rever uma a uma</button>
            </div>
            <div className="small muted">Ao gravar, a aplicação lê cada fatura (fornecedor, data, valor) e grava logo as que ficam completas e não estão repetidas. As que tiverem dúvidas ficam abertas para veres.</div>
          </div>
        )}
        {rows === null ? <div className="notice">A carregar…</div> : !list.length ? (
          <div className="empty">{view === 'pendente' ? 'Não há faturas do email por tratar.' : 'Nada aqui.'}</div>
        ) : (
          <div className="tablewrap"><table className="mini-table">
            <thead><tr>{view === 'pendente' && <th style={{ width: 28 }}><input type="checkbox" aria-label="Escolher todas" checked={list.length > 0 && chosen.length === list.length} onChange={e => toggle(list.map(r => r.id), e.target.checked)} /></th>}<th>Recebido</th><th>De</th><th>Assunto</th><th>Ficheiro</th><th></th></tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} className={sel.has(r.id) ? 'selected' : ''}>
                  {view === 'pendente' && <td><input type="checkbox" aria-label={`Escolher ${r.nome_ficheiro}`} checked={sel.has(r.id)} onChange={e => toggle([r.id], e.target.checked)} /></td>}
                  <td>{formatDate(String(r.recebido_em || r.created_at).slice(0, 10))}</td>
                  <td title={r.remetente || ''}>{senderName(r.remetente)}{r.conta ? <div className="small muted">para {r.conta}</div> : null}</td>
                  <td>{r.assunto}</td>
                  <td><button type="button" className="link-btn" onClick={() => open(r)}>{r.nome_ficheiro}</button> <span className="small muted">{kb(r.tamanho)}</span></td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {r.estado === 'pendente' && <>
                      <button type="button" className="primary" disabled={busy} onClick={() => review([r.id])}>Rever</button>{' '}
                      <button type="button" className="secondary" onClick={() => setEstado(r, 'ignorada')}>Ignorar</button>
                    </>}
                    {r.estado === 'gravada' && r.invoice_id && <Link to={`/faturas/${r.invoice_id}`}>Abrir fatura</Link>}
                    {r.estado !== 'pendente' && <> <button type="button" className="link-btn" onClick={() => setEstado(r, 'pendente')}>Voltar a pôr por tratar</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
      {!missing && <Ligacao chave={chave} setChave={setChave} />}
    </>
  )
}

function Ligacao({ chave, setChave }) {
  const toast = useToast()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!show || chave) return
    supabase.from('email_faturas_chave').select('chave').maybeSingle().then(({ data }) => data?.chave && setChave(data.chave))
  }, [show, chave, setChave])
  const code = useMemo(() => buildAppsScript({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || (localMode ? 'https://modo-local' : ''),
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    chave,
  }), [chave])

  async function copy() {
    try { await navigator.clipboard.writeText(code); toast('Código copiado.') } catch { toast('Não foi possível copiar. Seleciona o texto e copia à mão.', 'bad') }
  }
  async function novaChave() {
    const { data, error } = await supabase.rpc('nova_chave_email_faturas')
    if (error) return toast(error.message, 'bad')
    setChave(data)
    toast('Chave nova criada. Cola o código outra vez no Google (o antigo deixa de funcionar).')
  }

  return (
    <Panel title="Ligar um email" hint="Feito uma vez em cada conta Google que recebe faturas. Para emails que não são Gmail, cria uma regra que reencaminha as faturas para um destes Gmail.">
      {!show ? <button type="button" className="secondary" onClick={() => setShow(true)}>Mostrar instruções e código</button> : <>
        <ol className="small" style={{ lineHeight: 1.7 }}>
          <li>Abre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> com a conta que recebe as faturas (ex.: officedochalet@gmail.com). Abre um projeto novo e dá-lhe o nome <strong>Fatura Chalet</strong>.</li>
          <li>Apaga o que lá estiver, carrega em <strong>Copiar código</strong> aqui e cola lá. Carrega no ícone de gravar.</li>
          <li>Em cima, escolhe a função <strong>instalar</strong> e carrega em <strong>Executar</strong>. O Google pede autorização para ler o Gmail e ligar à internet: aceita (em "Avançadas" → "Aceder a Fatura Chalet").</li>
          <li>Pronto. A cada 15 minutos as faturas novas aparecem aqui em <em>Por tratar</em>. No Gmail ficam com a etiqueta <strong>Fatura Chalet</strong>.</li>
        </ol>
        <p className="small muted">O código tem uma chave secreta: não o partilhes. Só serve para pôr ficheiros nesta fila, não para ver dados.</p>
        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          <button type="button" className="primary" disabled={!chave} onClick={copy}>Copiar código</button>
          <ConfirmButton confirmText="Sim, criar chave nova" onConfirm={novaChave}>Gerar chave nova</ConfirmButton>
        </div>
        <textarea readOnly value={code} rows={12} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} onFocus={e => e.target.select()} />
      </>}
    </Panel>
  )
}
