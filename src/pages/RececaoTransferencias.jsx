import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { fetchAll } from '../data/DataProvider'
import { isAllocated, matchesTransfer } from '../lib/transfers'
import { euro } from '../lib/money'
import { formatDate, formatDateTime } from '../lib/dates'

// Aba "Transferências" da receção: confirmar se a transferência de um hóspede já chegou
// e alocá-la ao imóvel/quarto e à reserva. Só mostra a lista publicada pela administradora.
export default function RececaoTransferencias({ properties }) {
  const [list, setList] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('todas')
  const [open, setOpen] = useState(null)
  const propertiesById = useMemo(() => new Map(properties.map(p => [p.id, p.nome])), [properties])

  const load = useCallback(async () => {
    const rows = await fetchAll('transferencias', { order: 'data', ascending: false, optional: true })
    setUnavailable(rows === null)
    setList(rows || [])
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('rececao-transferencias')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transferencias' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const shown = (list || [])
    .filter(t => show === 'todas' || (show === 'alocadas') === isAllocated(t))
    .filter(t => matchesTransfer(t, q, propertiesById))
  const porAlocar = (list || []).filter(t => !isAllocated(t)).length

  return (
    <div className="panel">
      <h2>Transferências recebidas</h2>
      <div className="small">Transferências que já entraram na conta. Pesquisa pelo nome do hóspede, pelo valor ou pela reserva. Se a transferência não aparece, ainda não foi confirmada.</div>
      {unavailable && <div className="err">A lista de transferências ainda não está ativa. Avisa a administradora.</div>}
      <input className="trf-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar nome, valor (ex.: 120), quarto ou reserva…" aria-label="Pesquisar transferências" />
      <div className="trf-filter">
        {[['todas', 'Todas'], ['por-alocar', `Por alocar${porAlocar ? ` (${porAlocar})` : ''}`], ['alocadas', 'Alocadas']].map(([k, label]) => (
          <button key={k} type="button" className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{label}</button>
        ))}
      </div>
      {list === null ? <div className="small">A carregar…</div> : shown.length ? shown.map(t => (
        <div className="trf-row" key={t.id}>
          <div className="trf-main" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div>
              <strong>{t.ordenante || t.descricao || 'Sem nome'}</strong>
              <span className="small">{formatDate(t.data)}{isAllocated(t) && ` · ${[propertiesById.get(t.imovel_id), t.quarto && `Quarto ${t.quarto}`, t.reserva && `Reserva ${t.reserva}`].filter(Boolean).join(' · ')}`}</span>
              {t.notas && <span className="small">{t.notas}</span>}
            </div>
            <div className="trf-side">
              <strong className="trf-value">{euro(t.valor)}</strong>
              <span className={`badge ${isAllocated(t) ? 'ok' : 'pending'}`}>{isAllocated(t) ? 'Alocada' : 'Por alocar'}</span>
            </div>
          </div>
          {open === t.id
            ? <AllocateForm t={t} properties={properties} onDone={() => { setOpen(null); load() }} onCancel={() => setOpen(null)} />
            : <button type="button" className="link-btn" onClick={() => setOpen(t.id)}>{isAllocated(t) ? 'Alterar alocação' : 'Alocar a um quarto / reserva'}</button>}
        </div>
      )) : <div className="small">{q || show !== 'todas' ? 'Nenhuma transferência encontrada. Confirma o nome ou o valor; se ainda não aparece, ainda não chegou à conta.' : 'Ainda não há transferências registadas.'}</div>}
    </div>
  )
}

function AllocateForm({ t, properties, onDone, onCancel }) {
  const [f, setF] = useState({ imovel_id: t.imovel_id || '', quarto: t.quarto || '', reserva: t.reserva || '', notas: t.notas || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = patch => setF(x => ({ ...x, ...patch }))

  async function save(clear) {
    setBusy(true)
    setErr(null)
    const v = clear ? { imovel_id: '', quarto: '', reserva: '', notas: f.notas } : f
    const { error } = await supabase.rpc('alocar_transferencia', {
      p_id: t.id, p_imovel_id: v.imovel_id ? Number(v.imovel_id) : null, p_quarto: v.quarto, p_reserva: v.reserva, p_notas: v.notas,
    })
    setBusy(false)
    if (error) return setErr(`Não foi possível gravar: ${error.message}`)
    onDone()
  }

  return (
    <div className="trf-form">
      <div className="grid">
        <label>Imóvel<select value={f.imovel_id} onChange={e => set({ imovel_id: e.target.value })}><option value="">—</option>{properties.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
        <label>Quarto<input value={f.quarto} onChange={e => set({ quarto: e.target.value })} placeholder="Ex.: 12" /></label>
      </div>
      <label>Reserva<input value={f.reserva} onChange={e => set({ reserva: e.target.value })} placeholder="Nº da reserva ou nome do hóspede" /></label>
      <label>Notas <span className="opt">(opcional)</span><input value={f.notas} onChange={e => set({ notas: e.target.value })} placeholder="Ex.: sinal de 30%" /></label>
      {t.alocada_em && <div className="small">Alocada em {formatDateTime(t.alocada_em)}.</div>}
      {err && <div className="err">{err}</div>}
      <div className="trf-actions">
        <button type="button" className="secondary" onClick={onCancel}>Cancelar</button>
        {t.alocada_em && <button type="button" className="secondary" disabled={busy} onClick={() => save(true)}>Desfazer alocação</button>}
        <button type="button" className="btn" disabled={busy || !(f.imovel_id || f.quarto.trim() || f.reserva.trim())} onClick={() => save(false)}>{busy ? 'A gravar…' : 'Guardar'}</button>
      </div>
    </div>
  )
}
