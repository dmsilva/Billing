import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { supabase } from '../supabase'
import { useMonthOptions } from '../components/FilterBar'
import { ConfirmButton, Empty, Kpi, Modal, Panel, Select, useToast } from '../components/ui'
import { cashByMonth, cashCloseTotal, cashEntries } from '../lib/finance'
import { compareCloses, SHIFT_INFO, SHIFTS } from '../lib/reconciliation'
import { diffCashImport, parseCashSheets, parseCsvText } from '../lib/cashImport'
import { readWorkbook } from '../lib/xlsxLoader'
import { euroExact, parseMoney, sumBy } from '../lib/money'
import { formatDate, formatDateTime, monthLabel, monthOf, todayIso } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

const FIELD_LABEL = { dinheiro: 'Dinheiro', cv: 'CV', mb: 'MB', city_mb: 'City MB' }

export default function Caixa() {
  const { cash_closes, cash_checks, cash_imports, tpa_records, reload, upsertLocal } = useData()
  const { filters, set } = useFilters()
  const months = useMonthOptions()
  const nav = useNavigate()
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState(null)
  const rows = useMemo(() => cash_closes.filter(c => !filters.month || monthOf(c.data) === filters.month).sort(compareCloses), [cash_closes, filters.month])
  const e = cashEntries(rows)
  const perMonth = useMemo(() => cashByMonth(cash_closes), [cash_closes])
  const periodo = filters.month ? 'do mês' : 'do período'
  const checksByClose = useMemo(() => {
    const m = new Map()
    for (const c of cash_checks) m.set(c.cash_close_id, (m.get(c.cash_close_id) || 0) + 1)
    return m
  }, [cash_checks])
  const range = cash_closes.length ? `${formatDate([...cash_closes].sort(compareCloses)[0].data)} a ${formatDate([...cash_closes].sort(compareCloses).at(-1).data)}` : '—'

  async function undo(imp) {
    const { data, error } = await supabase.rpc('undo_cash_import', { p_import_id: imp.id })
    if (error) return toast(`Não foi possível anular: ${error.message}`, 'bad')
    toast(`Importação anulada: ${data.repostos} fechos repostos, ${data.removidos} removidos${data.mantidos_com_conferencia ? `, ${data.mantidos_com_conferencia} mantidos por já terem conferência` : ''}.`)
    reload('cash_closes')
    reload('cash_imports')
  }

  const exportCsv = () => downloadText(toCsv(['Data', 'Turno', 'Horário', 'Dinheiro', 'CV', 'MB', 'City MB', 'Total', 'Registos', 'Origem'],
    rows.map(c => [c.data, c.turno, SHIFT_INFO[c.turno]?.horas, decimalPt(c.dinheiro), decimalPt(c.cv), decimalPt(c.mb), decimalPt(c.city_mb), decimalPt(cashCloseTotal(c)), c.registos ?? '', c.origem])), 'caixa_diaria.csv')

  return (
    <div className="cash-page">
      <div className="cash-hero">
        <div>
          <div className="eyebrow">ENTRADAS · CAIXA</div>
          <h2>Caixa diária</h2>
          <p>Consulta os fechos dos colaboradores por dia e por turno, sem precisares de abrir o Excel.</p>
        </div>
        <div className="cash-hero-actions">
          <Select value={filters.month} onChange={v => set({ month: v })} options={months} placeholder="Todos os meses" />
          <button className="secondary" onClick={exportCsv}>Exportar CSV</button>
          <button className="primary" onClick={() => setImporting(true)}>Importar Excel / CSV</button>
        </div>
      </div>
      <div className="notice">Dados carregados: <strong>{cash_closes.length} fechos</strong> ({range}). Sincronizados no Supabase em todos os dispositivos.</div>
      <div className="cash-kpis">
        <Kpi color="blue" icon="▣" label="Dias com registo" value={e.dias} note="Caixa diária" />
        <Kpi color="green" icon="€" label="Dinheiro" value={euroExact(e.dinheiro)} note="Total dos fechos" />
        <Kpi color="purple" icon="MB" label="MB" value={euroExact(e.mb)} note={`City MB: ${euroExact(e.cityMb)}`} />
        <Kpi color="orange" icon="CV" label="CV" value={euroExact(e.cv)} note="Cartão virtual" />
        <Kpi color="blue" icon="Σ" label={`Total ${periodo}`} value={euroExact(e.total)} note="Dinheiro + CV + MB + City MB" />
      </div>
      <div className="cash-layout">
        <Panel title="Fechos por dia" hint="7h · 15h · 23h">
          <div className="cash-shift-summary">
            {SHIFTS.map(s => <div key={s}><span>{s} · {SHIFT_INFO[s].nome}</span><strong>{euroExact(sumBy(rows.filter(r => r.turno === s), cashCloseTotal))}</strong></div>)}
          </div>
          <div className="tablewrap tall">
            <table>
              <thead><tr><th>Data</th><th>Turno</th><th>Horário</th><th className="money">Dinheiro</th><th className="money">CV</th><th className="money">MB</th><th className="money">City MB</th><th className="money">Total</th><th className="money">Registos</th><th>Conferência</th><th /></tr></thead>
              <tbody>
                {rows.length ? rows.map(c => (
                  <tr key={c.id}>
                    <td>{formatDate(c.data)}</td><td>{c.turno}</td><td>{SHIFT_INFO[c.turno]?.horas}</td>
                    <td className="money">{euroExact(c.dinheiro)}</td><td className="money">{euroExact(c.cv)}</td><td className="money">{euroExact(c.mb)}</td><td className="money">{euroExact(c.city_mb)}</td>
                    <td className="money"><strong>{euroExact(cashCloseTotal(c))}</strong></td>
                    <td className="money">{c.registos ?? '—'}</td>
                    <td>{checksByClose.get(c.id) === 3 ? '🟢 Conferido' : checksByClose.get(c.id) ? `🟡 ${checksByClose.get(c.id)}/3` : '⚪ Por conferir'}</td>
                    <td><button className="link-btn" onClick={() => setEditing(c)}>✎</button></td>
                  </tr>
                )) : <Empty colSpan={11}>Ainda não existem fechos neste período.</Empty>}
              </tbody>
              {rows.length > 0 && (
                <tfoot><tr className="cash-total-row">
                  <td colSpan={3}><strong>Total {periodo}</strong></td>
                  <td className="money">{euroExact(e.dinheiro)}</td><td className="money">{euroExact(e.cv)}</td><td className="money">{euroExact(e.mb)}</td><td className="money">{euroExact(e.cityMb)}</td>
                  <td className="money"><strong>{euroExact(e.total)}</strong></td><td colSpan={3} />
                </tr></tfoot>
              )}
            </table>
          </div>
        </Panel>
        <Panel title="Conferência" hint="Confirma os envelopes quando estiveres com o dinheiro em mão." className="cash-side-card">
          <div className="conference-mini-icon">✓</div>
          <strong className="conference-mini-title">Pronto para conferir?</strong>
          <p className="conference-mini-text">A conferência percorre automaticamente CV → MB → Numerário e passa para o próximo envelope.</p>
          <button className="primary full-btn" onClick={() => nav('/conferencia')}>Abrir conferência</button>
          <button className="secondary full-btn" onClick={() => setEditing({ data: todayIso(), turno: '7h', dinheiro: 0, cv: 0, mb: 0, city_mb: 0 })}>Registar fecho manualmente</button>
        </Panel>
      </div>
      <Panel title="Totais por mês" hint="Carrega num mês para ver os fechos desse mês.">
        {perMonth.length ? (
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Mês</th><th className="money">Dias</th><th className="money">Dinheiro</th><th className="money">CV</th><th className="money">MB</th><th className="money">City MB</th><th className="money">Total</th></tr></thead>
            <tbody>{perMonth.map(m => (
              <tr key={m.mes} className={`clickable${m.mes === filters.month ? ' row-selected' : ''}`} onClick={() => set({ month: m.mes })}>
                <td>{monthLabel(m.mes)}</td><td className="money">{m.dias}</td><td className="money">{euroExact(m.dinheiro)}</td><td className="money">{euroExact(m.cv)}</td><td className="money">{euroExact(m.mb)}</td><td className="money">{euroExact(m.cityMb)}</td><td className="money"><strong>{euroExact(m.total)}</strong></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="emptybox">Ainda não existem fechos.</div>}
      </Panel>
      <div className="notice"><strong>Formato aceite:</strong> o Excel da Caixa Diária (uma folha por dia, colunas Hóspede, Quarto, Dinheiro, CV, MB, city mb, Funcionário e linhas “Fecho 7h”, “Fecho 15h”, “Fecho 23h”) ou uma tabela simples com Data, Turno, Dinheiro, CV, MB, City MB. Antes de gravar vês o que é novo e o que muda.</div>

      <Panel title="Histórico de importações" hint="Cada importação guarda os valores anteriores e pode ser anulada.">
        {cash_imports.length ? (
          <table className="mini-table">
            <thead><tr><th>Data</th><th>Ficheiro</th><th className="money">Novos</th><th className="money">Alterados</th><th className="money">Iguais</th><th /></tr></thead>
            <tbody>{cash_imports.map(i => (
              <tr key={i.id} className={i.anulada_em ? 'row-muted' : ''}>
                <td>{formatDateTime(i.importado_em)}</td><td>{i.nome_ficheiro}</td><td className="money">{i.novos}</td><td className="money">{i.alterados}</td><td className="money">{i.iguais}</td>
                <td>{i.anulada_em ? `Anulada em ${formatDateTime(i.anulada_em)}` : (i.novos + i.alterados > 0 && <ConfirmButton className="link-btn" confirmText="Anular importação" onConfirm={() => undo(i)}>Anular</ConfirmButton>)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="emptybox">Ainda não houve importações. Os 819 fechos de janeiro a setembro de 2026 vieram do HTML legado.</div>}
      </Panel>

      <TpaPanel records={tpa_records} month={filters.month} upsertLocal={upsertLocal} />

      {importing && <CashImportModal existing={cash_closes} onClose={() => setImporting(false)} onDone={() => { reload('cash_closes'); reload('cash_imports') }} />}
      {editing && <CloseEditModal close={editing} existing={cash_closes} onClose={() => setEditing(null)} onDone={() => { reload('cash_closes'); reload('cash_imports') }} />}
    </div>
  )
}

function CashImportModal({ existing, onClose, onDone }) {
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  async function read(f) {
    setFile(f)
    setResult(null)
    try {
      const sheets = f.name.toLowerCase().endsWith('.csv') ? [{ name: f.name, matrix: parseCsvText(await f.text()) }] : await readWorkbook(f)
      const parsed = parseCashSheets(sheets)
      setResult({ ...parsed, diff: diffCashImport(existing, parsed.records) })
    } catch (e) {
      setResult({ error: `Não foi possível ler este ficheiro (${e.message}).` })
    }
  }

  async function save() {
    setBusy(true)
    const rows = [...result.diff.novos, ...result.diff.alterados.map(a => a.depois)]
    const { error } = await supabase.rpc('import_cash_closes', { p_rows: rows, p_file: file.name, p_origem: 'excel' })
    setBusy(false)
    if (error) return toast(`Erro na importação: ${error.message}`, 'bad')
    toast(`Importados ${result.diff.novos.length} fechos novos e ${result.diff.alterados.length} atualizados.`)
    onDone()
    onClose()
  }

  const d = result?.diff
  return (
    <Modal title="Importar Caixa Diária" onClose={onClose} wide>
      <label className="file-button"><input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files[0] && read(e.target.files[0])} />{file ? file.name : 'Escolher Excel / CSV da Caixa Diária'}</label>
      {result?.error && <div className="notice bad">{result.error}</div>}
      {d && (
        <>
          {!result.records.length && <div className="notice bad">Não encontrei linhas “Fecho 7h/15h/23h”. Confirma o formato da Caixa Diária.</div>}
          {result.warnings.length > 0 && <details className="notice"><summary>{result.warnings.length} avisos</summary><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          <div className="grid3">
            <div className="card"><div className="label">Novos</div><div className="value">{d.novos.length}</div></div>
            <div className="card"><div className="label">Com valores diferentes</div><div className="value">{d.alterados.length}</div></div>
            <div className="card"><div className="label">Iguais (ignorados)</div><div className="value">{d.iguais.length}</div></div>
          </div>
          {d.alterados.length > 0 && (
            <>
              <div className="subhead">Fechos que vão mudar (os valores anteriores ficam guardados no histórico)</div>
              <div className="tablewrap"><table className="mini-table"><thead><tr><th>Data</th><th>Turno</th><th>Campo</th><th className="money">Atual</th><th className="money">Novo</th></tr></thead>
                <tbody>{d.alterados.flatMap(a => a.campos.map(f => <tr key={`${a.depois.data}${a.depois.turno}${f}`}><td>{formatDate(a.depois.data)}</td><td>{a.depois.turno}</td><td>{FIELD_LABEL[f]}</td><td className="money">{euroExact(a.antes[f])}</td><td className="money"><strong>{euroExact(a.depois[f])}</strong></td></tr>))}</tbody>
              </table></div>
            </>
          )}
          {d.novos.length > 0 && <div className="muted small">Novos: {formatDate(d.novos[0].data)} a {formatDate(d.novos.at(-1).data)}</div>}
          <div className="actions end">
            <button className="secondary" onClick={onClose}>Cancelar</button>
            <button className="primary" disabled={busy || !(d.novos.length + d.alterados.length)} onClick={save}>{busy ? 'A importar…' : `Importar ${d.novos.length + d.alterados.length} fechos`}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

function CloseEditModal({ close, existing, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ ...close, dinheiro: String(close.dinheiro).replace('.', ','), cv: String(close.cv).replace('.', ','), mb: String(close.mb).replace('.', ','), city_mb: String(close.city_mb).replace('.', ',') })
  const isNew = !close.id
  async function save() {
    const row = { data: f.data, turno: f.turno }
    for (const k of ['dinheiro', 'cv', 'mb', 'city_mb']) {
      const v = parseMoney(f[k])
      if (v === null || v < 0) return toast(`Valor inválido em ${FIELD_LABEL[k]}.`, 'bad')
      row[k] = v
    }
    if (isNew && existing.some(c => c.data === row.data && c.turno === row.turno)) return toast('Já existe um fecho para esse dia e turno. Edita-o na tabela.', 'bad')
    const { error } = await supabase.rpc('import_cash_closes', { p_rows: [row], p_file: isNew ? 'Registo manual' : `Correção manual ${formatDate(row.data)} ${row.turno}`, p_origem: 'manual' })
    if (error) return toast(error.message, 'bad')
    toast('Fecho guardado.')
    onDone()
    onClose()
  }
  return (
    <Modal title={isNew ? 'Registar fecho' : `Corrigir fecho ${formatDate(close.data)} · ${close.turno}`} onClose={onClose}>
      <div className="form-grid">
        <label>Data<input type="date" value={f.data} disabled={!isNew} onChange={e => setF({ ...f, data: e.target.value })} /></label>
        <label>Turno<Select value={f.turno} disabled={!isNew} onChange={v => setF({ ...f, turno: v })} options={SHIFTS} /></label>
        {Object.entries(FIELD_LABEL).map(([k, l]) => <label key={k}>{l}<input inputMode="decimal" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
      </div>
      <p className="muted small">A alteração fica registada no histórico de importações e pode ser anulada. As conferências já feitas mantêm o valor esperado da altura e passam a mostrar o aviso de que o fecho mudou.</p>
      <div className="actions end"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={save}>Guardar</button></div>
    </Modal>
  )
}

function TpaPanel({ records, month, upsertLocal }) {
  const toast = useToast()
  const [f, setF] = useState({ data: todayIso(), turno: '7h', cv: '', mb: '' })
  const rows = records.filter(r => !month || monthOf(r.data) === month).sort(compareCloses)
  async function save() {
    const cv = parseMoney(f.cv) ?? 0
    const mb = parseMoney(f.mb) ?? 0
    if (!f.data) return toast('Escolhe a data.', 'bad')
    const { data, error } = await supabase.from('tpa_records').upsert({ data: f.data, turno: f.turno, cv, mb }, { onConflict: 'data,turno' }).select().single()
    if (error) return toast(error.message, 'bad')
    upsertLocal('tpa_records', data)
    setF({ ...f, cv: '', mb: '' })
    toast('Valores do TPA guardados.')
  }
  return (
    <Panel title="TPA / CGD" hint="Regista os valores confirmados nos dois TPA da CGD: o primeiro para CV/cartões virtuais e o segundo para os restantes cartões.">
      <div className="filters flat tpa">
        <input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} />
        <Select value={f.turno} onChange={v => setF({ ...f, turno: v })} options={SHIFTS.map(s => ({ value: s, label: `Fecho ${s}` }))} />
        <input inputMode="decimal" placeholder="TPA CV" value={f.cv} onChange={e => setF({ ...f, cv: e.target.value })} />
        <input inputMode="decimal" placeholder="TPA MB" value={f.mb} onChange={e => setF({ ...f, mb: e.target.value })} />
        <button className="primary" onClick={save}>Guardar TPA</button>
      </div>
      {rows.length ? (
        <table className="mini-table"><thead><tr><th>Data</th><th>Turno</th><th className="money">TPA CV</th><th className="money">TPA MB</th><th className="money">Total</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{formatDate(r.data)}</td><td>{r.turno}</td><td className="money">{euroExact(r.cv)}</td><td className="money">{euroExact(r.mb)}</td><td className="money"><strong>{euroExact(Number(r.cv) + Number(r.mb))}</strong></td></tr>)}</tbody>
        </table>
      ) : <div className="emptybox">Ainda não existem valores de TPA.</div>}
    </Panel>
  )
}
