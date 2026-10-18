import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { supabase } from '../supabase'
import { useMonthOptions } from '../components/FilterBar'
import { ConfirmButton, Modal, Panel, Select, useToast } from '../components/ui'
import { buildQueue, checkDifference, checkIcon, checkLabel, checkStatus, differencesSummary, expectedChanged, nextLabel, nextPendingIndex, progress, resolveActual, SHIFT_INFO, CHECK_TYPES } from '../lib/reconciliation'
import { euro, euroExact } from '../lib/money'
import { formatDate, formatDateTime, monthOf } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

const STATE_ICON = { pending: '🟡', ok: '🟢', bad: '🔴' }

export default function Conferencia() {
  const { cash_closes, cash_checks, upsertLocal, removeLocal, reload } = useData()
  const { user } = useAuth()
  const { filters, set } = useFilters()
  const months = useMonthOptions()
  const toast = useToast()
  const [raw, setRaw] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const inputRef = useRef(null)

  const closes = useMemo(() => cash_closes.filter(c => !filters.month || monthOf(c.data) === filters.month), [cash_closes, filters.month])
  const items = useMemo(() => buildQueue(closes, cash_checks), [closes, cash_checks])
  const prog = progress(items)
  const idx = nextPendingIndex(items)
  const current = idx >= 0 ? items[idx] : null
  const diffs = differencesSummary(items)

  useEffect(() => {
    setRaw('')
    setError(null)
    inputRef.current?.focus()
  }, [current?.close.id, current?.type])

  async function saveCheck(close, type, valorReal, expected) {
    const row = { cash_close_id: close.id, tipo: type, valor_esperado: expected, valor_real: valorReal, conferido_por: user.id, conferido_em: new Date().toISOString() }
    const { data, error: err } = await supabase.from('cash_checks').upsert(row, { onConflict: 'cash_close_id,tipo' }).select().single()
    if (err) {
      toast(`Não foi possível guardar a conferência: ${err.message}`, 'bad')
      return false
    }
    upsertLocal('cash_checks', data)
    return true
  }

  async function confirm() {
    if (!current || saving) return
    const res = resolveActual(raw, current.expected)
    if (!res.ok) { setError(res.error); inputRef.current?.focus(); return }
    setSaving(true)
    await saveCheck(current.close, current.type, res.value, current.expected)
    setSaving(false)
  }

  async function clearChecks() {
    const ids = items.filter(i => i.check).map(i => i.check.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error: err } = await supabase.from('cash_checks').delete().in('id', ids.slice(i, i + 200))
      if (err) { toast(err.message, 'bad'); reload('cash_checks'); return }
    }
    removeLocal('cash_checks', ids)
    toast(`${ids.length} conferências removidas (ficam no histórico).`)
  }

  const byClose = useMemo(() => {
    const m = new Map()
    for (const i of items) {
      if (!m.has(i.close.id)) m.set(i.close.id, { close: i.close, cells: {} })
      m.get(i.close.id).cells[i.type] = i
    }
    return [...m.values()]
  }, [items])
  const currentPos = current ? byClose.findIndex(r => r.close.id === current.close.id) : byClose.length - 1
  const visible = (onlyIssues ? byClose.filter(r => Object.values(r.cells).some(c => checkStatus(c.check) === 'bad' || expectedChanged(c))) : showAll ? byClose : byClose.slice(Math.max(0, currentPos - 9), currentPos + 30))

  const exportCsv = () => downloadText(toCsv(['Data', 'Turno', 'Tipo', 'Esperado', 'Real', 'Diferença', 'Estado', 'Conferido em'],
    items.map(i => [i.close.data, i.close.turno, checkLabel(i.type), decimalPt(i.expected), decimalPt(i.check?.valor_real), decimalPt(checkDifference(i.check)), { pending: 'Por conferir', ok: 'Bate certo', bad: 'Diferença' }[checkStatus(i.check)], i.check?.conferido_em || ''])), 'conferencia.csv')

  return (
    <div className="conference-page">
      <div className="cash-hero">
        <div>
          <div className="eyebrow">ENTRADAS · CONFERÊNCIA</div>
          <h2>Conferência de caixa</h2>
          <p>Uma fila simples para conferires os envelopes, sem andares a procurar o dia e o turno.</p>
        </div>
        <div className="cash-hero-actions">
          <Select value={filters.month} onChange={v => set({ month: v })} options={months} placeholder="Todos os meses" />
          <div className="conference-counter">{prog.done} / {prog.total} conferências</div>
        </div>
      </div>

      <div className="conference-progress-wrap">
        <div className="conference-progress-head"><strong>Progresso</strong><span>{prog.pct}%</span></div>
        <div className="progress-track"><i style={{ width: `${prog.pct}%` }} /></div>
      </div>

      <div className="conference-grid">
        <Panel title="Próximo envelope" hint="Confirma os valores pela ordem apresentada." actions={<span className={`status ${current ? 'pending' : ''}`}>{current ? 'Por conferir' : 'Concluído'}</span>}>
          {!items.length ? <div className="emptybox">Não existem caixas neste período.</div> : current ? (
            <div className="cash-check-card">
              <div className="reconcile-current">
                <div className="meta">PRÓXIMA CONFERÊNCIA</div>
                <div className="reconcile-title">{formatDate(current.close.data)} · Fecho {current.close.turno}</div>
                <div className="meta">{SHIFT_INFO[current.close.turno]?.horas} · {prog.total - prog.done} por conferir</div>
                <div className="steps-inline">
                  {CHECK_TYPES.map(t => {
                    const it = items.find(i => i.close.id === current.close.id && i.type === t)
                    return <span key={t} className={`step-chip ${t === current.type ? 'now' : it?.check ? checkStatus(it.check) : ''}`}>{checkLabel(t)}</span>
                  })}
                </div>
              </div>
              <div className="reconcile-value">
                <div className="meta">{checkIcon(current.type)} Valor {checkLabel(current.type)}: confere?</div>
                <div className="expected">{euroExact(current.expected)}</div>
                <div className="meta">Valor esperado neste fecho · a seguir: {nextLabel(current.type)}</div>
              </div>
              <form className="reconcile-input" onSubmit={e => { e.preventDefault(); confirm() }}>
                <div className="meta">Se não bater, escreve aqui o valor que tens</div>
                <div className="input-row">
                  <input ref={inputRef} inputMode="decimal" autoComplete="off" value={raw} onChange={e => { setRaw(e.target.value); setError(null) }} placeholder="Se bater certo, carrega Enter" aria-label="Valor real" />
                  <button className="primary" disabled={saving} type="submit">✓ OK — CONTINUAR</button>
                </div>
                <div className={`check-status ${error ? 'bad' : 'pending'}`}>{error || 'OK / ENTER = bate certo · ou escreve o valor real'}</div>
              </form>
            </div>
          ) : <div className="cash-check-card done"><div className="reconcile-title">🎉 Todas as caixas deste período estão conferidas.</div></div>}
        </Panel>
        <Panel title="Como funciona" hint="Três confirmações por envelope." className="conference-help">
          <div className="step"><b>1</b><div><strong>CV</strong><span>Compara com o valor do fecho.</span></div></div>
          <div className="step"><b>2</b><div><strong>MB</strong><span>Confirma o valor dos cartões.</span></div></div>
          <div className="step"><b>3</b><div><strong>Numerário</strong><span>Conta o dinheiro físico do envelope.</span></div></div>
          <div className="conference-tip">💡 <strong>Enter</strong> confirma. Se houver diferença, escreve o valor real e carrega Enter. Para corrigir, usa ✎ no histórico.</div>
          <div className={`diff-box ${diffs.count ? 'bad' : 'ok'}`}>
            <strong>{diffs.count ? `${diffs.count} diferenças registadas` : 'Sem diferenças'}</strong>
            {diffs.count > 0 && <span>Em falta: {euro(diffs.falta)} · A mais: {euro(diffs.sobra)}</span>}
          </div>
        </Panel>
      </div>

      <Panel title="Histórico da conferência" hint="🟢 Conferido · 🔴 Diferença · 🟡 Por conferir"
        actions={<>
          <label className="check-inline"><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> Só diferenças</label>
          {!onlyIssues && byClose.length > 40 && <button className="secondary" onClick={() => setShowAll(s => !s)}>{showAll ? 'Mostrar perto do atual' : `Mostrar todos (${byClose.length})`}</button>}
          <button className="secondary" onClick={exportCsv}>Exportar CSV</button>
          <ConfirmButton disabled={!prog.done} confirmText={`Limpar ${prog.done} conferências`} onConfirm={clearChecks}>Limpar conferências</ConfirmButton>
        </>}>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Turno</th><th>CV</th><th>MB</th><th>Numerário</th></tr></thead>
            <tbody>
              {visible.map(({ close, cells }) => (
                <tr key={close.id} className={current?.close.id === close.id ? 'row-selected' : ''}>
                  <td>{formatDate(close.data)}</td><td>{close.turno}</td>
                  {CHECK_TYPES.map(t => {
                    const it = cells[t]
                    const st = checkStatus(it.check)
                    return (
                      <td key={t} className={`row-${st === 'pending' ? 'pending' : st === 'ok' ? 'ok' : 'bad'}`}>
                        <div className="cell-line"><strong>{euroExact(it.expected)}</strong><button type="button" className="link-btn" title="Corrigir" onClick={() => setEditing(it)}>✎</button></div>
                        <small>{it.check ? `${euroExact(it.check.valor_real)} ${STATE_ICON[st]}${st === 'bad' ? ` (${euro(checkDifference(it.check))})` : ''}` : 'por conferir'}</small>
                        {expectedChanged(it) && <small className="warn">⚠ o fecho mudou: esperado na conferência {euroExact(it.check.valor_esperado)}</small>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {editing && <CorrectModal item={editing} onClose={() => setEditing(null)} onSave={async v => { if (await saveCheck(editing.close, editing.type, v, editing.expected)) setEditing(null) }} onRemove={async () => {
        const { error: err } = await supabase.from('cash_checks').delete().eq('id', editing.check.id)
        if (err) return toast(err.message, 'bad')
        removeLocal('cash_checks', editing.check.id)
        setEditing(null)
      }} />}
    </div>
  )
}

function CorrectModal({ item, onClose, onSave, onRemove }) {
  const [raw, setRaw] = useState(item.check ? String(item.check.valor_real).replace('.', ',') : '')
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  useEffect(() => {
    supabase.from('cash_check_history').select('*').eq('cash_close_id', item.close.id).eq('tipo', item.type).order('em', { ascending: false }).then(({ data }) => setHistory(data || []))
  }, [item.close.id, item.type])
  function submit(e) {
    e.preventDefault()
    const res = resolveActual(raw, item.expected)
    if (!res.ok) return setError(res.error)
    onSave(res.value)
  }
  return (
    <Modal title={`Corrigir ${checkLabel(item.type)} — ${formatDate(item.close.data)} · Fecho ${item.close.turno}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p>Esperado: <strong>{euroExact(item.expected)}</strong></p>
        <label>Valor que tens<input autoFocus inputMode="decimal" value={raw} onChange={e => { setRaw(e.target.value); setError(null) }} placeholder="Vazio = bate certo" /></label>
        {error && <div className="notice bad">{error}</div>}
        <div className="actions end">
          {item.check && <ConfirmButton className="secondary" confirmText="Marcar como por conferir" onConfirm={onRemove}>Desfazer conferência</ConfirmButton>}
          <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
          <button className="primary">Guardar</button>
        </div>
      </form>
      {history.length > 0 && (
        <>
          <div className="subhead">Histórico</div>
          <table className="mini-table"><thead><tr><th>Quando</th><th>Ação</th><th className="money">Antes</th><th className="money">Depois</th></tr></thead>
            <tbody>{history.map(h => <tr key={h.id}><td>{formatDateTime(h.em)}</td><td>{h.acao}</td><td className="money">{h.valor_real_anterior == null ? '—' : euroExact(h.valor_real_anterior)}</td><td className="money">{h.valor_real_novo == null ? '—' : euroExact(h.valor_real_novo)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </Modal>
  )
}
