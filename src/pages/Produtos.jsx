import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useData } from '../data/DataProvider'
import { readStoredInvoiceLines } from '../data/invoiceReading'
import { Badge, Empty, Kpi, Panel, RankBars, Select, useToast } from '../components/ui'
import { breakfastAnalysis, byProductType, lineSupplier } from '../lib/finance'
import { byArtigo, invoicesToRead, lineArtigo, lineDate, linesInPeriod, periodPresets, totalOf } from '../lib/artigos'
import { euro, numberPt } from '../lib/money'
import { decimalPt, downloadText, toCsv } from '../lib/csv'
import { formatDate, todayIso } from '../lib/dates'

const qtyText = qs => qs.map(q => `${numberPt(q.quantidade, q.quantidade % 1 ? 2 : 0)} ${q.unidade}`).join(' · ')

export default function Produtos() {
  const { invoice_lines, invoices } = useData()
  const presets = useMemo(() => periodPresets(todayIso()), [])
  const [period, setPeriod] = useState(() => presets.find(p => p.key === 'ano'))
  const [tipo, setTipo] = useState('')
  const [artigo, setArtigo] = useState('')
  const [q, setQ] = useState('')
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices])
  const inPeriod = useMemo(() => linesInPeriod(invoice_lines, invoicesById, period), [invoice_lines, invoicesById, period])
  const types = [...new Set(invoice_lines.map(l => l.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'))
  const search = q.trim().toLowerCase()
  const filtered = inPeriod.filter(l => (!tipo || l.tipo === tipo) && (!search || `${l.produto} ${l.artigo || ''} ${l.tipo} ${l.observacao || ''} ${l.fornecedor || ''}`.toLowerCase().includes(search)))
  const groups = useMemo(() => byArtigo(filtered), [filtered])
  const rows = filtered
    .filter(l => !artigo || lineArtigo(l).toLowerCase() === artigo.toLowerCase())
    .sort((a, b) => String(lineDate(b, invoicesById) || '').localeCompare(String(lineDate(a, invoicesById) || '')) || (Number(b.valor) || -1) - (Number(a.valor) || -1))
  const breakfast = breakfastAnalysis(inPeriod)
  const pending = invoicesToRead(invoices, invoice_lines)

  const setDates = patch => setPeriod(p => ({ ...p, key: '', ...patch }))
  const exportArtigos = () => downloadText(toCsv(['Artigo', 'Categoria', 'Quantidade', 'Gasto', 'Compras', 'Fornecedores'],
    groups.map(g => [g.artigo, g.tipo, qtyText(g.quantidades), decimalPt(g.total), String(g.compras), g.fornecedores.join(', ')])), `gasto-por-artigo${period.de ? `-${period.de}` : ''}${period.ate ? `-a-${period.ate}` : ''}.csv`)
  const exportLines = () => downloadText(toCsv(['Data', 'Artigo', 'Produto', 'Unidade', 'Quantidade', 'Gasto', 'Categoria', 'Fornecedor', 'Observação'],
    rows.map(l => [lineDate(l, invoicesById) || '', lineArtigo(l), l.produto, l.unidade, l.quantidade == null ? '' : String(l.quantidade).replace('.', ','), decimalPt(l.valor), l.tipo, lineSupplier(l) || '', l.observacao])), 'produtos.csv')

  return (
    <>
      <Panel title="Gasto por artigo" hint="Artigos lidos das faturas e recibos. O mesmo produto de marcas ou fornecedores diferentes soma no mesmo artigo (ex.: todas as manteigas em “Manteiga”). Faturas rejeitadas não contam.">
        <div className="filters flat">
          <Select value={period.key} onChange={k => k && setPeriod(presets.find(p => p.key === k))} options={presets.map(p => ({ value: p.key, label: p.label }))} placeholder="Período à medida" />
          <label className="inline-field">De <input type="date" value={period.de} onChange={e => setDates({ de: e.target.value })} /></label>
          <label className="inline-field">Até <input type="date" value={period.ate} onChange={e => setDates({ ate: e.target.value })} /></label>
          <Select value={tipo} onChange={setTipo} options={types} placeholder="Todas as categorias" />
          <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar (ex.: manteiga, leite, detergente)…" />
        </div>
        <div className="grid4">
          <Kpi color="blue" icon="€" label="Gasto no período" value={euro(totalOf(filtered))} note={`${filtered.length} linha(s) de faturas`} />
          <Kpi color="green" icon="◌" label="Artigos diferentes" value={groups.length} />
          <Kpi color="orange" icon="🧈" label={groups[0] ? `Maior gasto: ${groups[0].artigo}` : 'Maior gasto'} value={groups[0] ? euro(groups[0].total) : '—'} />
          <Kpi color="purple" icon="🔎" label="Faturas por ler" value={pending.length} note={pending.length ? 'ver em baixo' : 'todas lidas'} />
        </div>
      </Panel>

      <Panel title="Por artigo" hint="Clica num artigo para ver as compras. Usa ✎ para mudar o nome e juntar artigos (ex.: “Manteiga sem sal” em “Manteiga”)." actions={<button className="secondary" onClick={exportArtigos} disabled={!groups.length}>Exportar CSV</button>}>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Artigo</th><th>Categoria</th><th className="money">Quantidade</th><th className="money">Gasto</th><th className="money">Compras</th><th>Fornecedores</th><th /></tr></thead>
            <tbody>
              {groups.length ? groups.map(g => (
                <tr key={g.artigo} className={artigo.toLowerCase() === g.artigo.toLowerCase() ? 'selected' : ''}>
                  <td><button className="link-btn" onClick={() => setArtigo(artigo.toLowerCase() === g.artigo.toLowerCase() ? '' : g.artigo)}><strong>{g.artigo}</strong></button></td>
                  <td><Badge>{g.tipo}</Badge></td>
                  <td className="money">{qtyText(g.quantidades) || '—'}</td>
                  <td className="money"><strong>{euro(g.total)}</strong>{g.semValor > 0 && <div className="small muted">{g.semValor} sem valor</div>}</td>
                  <td className="money">{g.compras}</td>
                  <td className="wrap small">{g.fornecedores.join(', ') || '—'}</td>
                  <td><RenameArtigo group={g} /></td>
                </tr>
              )) : <Empty colSpan={7}>Sem artigos neste período. {pending.length > 0 && 'Há faturas por ler: usa o botão em baixo.'}</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="twocol">
        <Panel title="Por categoria de produto"><RankBars rows={byProductType(filtered).map(t => ({ label: t.nome, value: t.total }))} onClick={r => setTipo(r.label)} /></Panel>
        <Panel title="☕ Pequeno-almoço por fornecedor" hint={`Total identificado: ${euro(breakfast.total)}`}>
          <RankBars rows={breakfast.suppliers.map(s => ({ label: s.nome, value: s.total }))} max={breakfast.total || 1} />
          <div className="hint">Entram alimentos, laticínios, fruta e bebidas não alcoólicas. Detergentes, consumíveis e álcool ficam fora.</div>
        </Panel>
      </div>

      <Panel title={artigo ? `Compras de ${artigo}` : 'Todas as linhas'} hint={artigo ? `${rows.length} compra(s) · ${euro(totalOf(rows))}` : undefined}
        actions={<>{artigo && <button className="secondary" onClick={() => setArtigo('')}>Ver todos os artigos</button>}<button className="secondary" onClick={exportLines}>Exportar linhas CSV</button></>}>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Data</th><th>Artigo</th><th>Produto</th><th className="money">Quantidade</th><th className="money">Gasto</th><th>Categoria</th><th>Fornecedor</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(l => (
                <tr key={l.id}>
                  <td>{lineDate(l, invoicesById) ? formatDate(lineDate(l, invoicesById)) : '—'}</td>
                  <td><strong>{lineArtigo(l)}</strong></td>
                  <td>{l.produto}{l.invoice_id && <div className="small"><Link to={`/faturas/${l.invoice_id}`}>ver fatura</Link></div>}</td>
                  <td className="money">{l.quantidade == null ? '—' : `${numberPt(l.quantidade, 3)} ${l.unidade || ''}`}</td>
                  <td className="money">{l.valor == null ? '—' : euro(l.valor)}</td>
                  <td><Badge>{l.tipo}</Badge></td>
                  <td>{lineSupplier(l) || '—'}</td>
                </tr>
              )) : <Empty colSpan={7}>Sem linhas para este filtro.</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>

      <ReadPending pending={pending} />
    </>
  )
}

// Muda o nome de um artigo em todas as linhas (serve também para juntar dois artigos).
function RenameArtigo({ group }) {
  const toast = useToast()
  const { invoice_lines, reload } = useData()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.artigo)
  async function save(e) {
    e.preventDefault()
    const novo = name.trim()
    setEditing(false)
    if (!novo || novo === group.artigo) return
    const key = group.artigo.toLowerCase()
    const ids = invoice_lines.filter(l => lineArtigo(l).toLowerCase() === key).map(l => l.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('invoice_lines').update({ artigo: novo }).in('id', ids.slice(i, i + 200))
      if (error) return toast(`Erro: ${error.message}`, 'bad')
    }
    reload('invoice_lines')
    toast(`${ids.length} linha(s) passaram para “${novo}”.`)
  }
  if (!editing) return <button className="link-btn" title="Mudar o nome deste artigo em todas as faturas" onClick={() => { setName(group.artigo); setEditing(true) }}>✎</button>
  return (
    <form onSubmit={save} className="inline-edit">
      <input className="cell" autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={save} onKeyDown={e => e.key === 'Escape' && setEditing(false)} />
    </form>
  )
}

// Lê os artigos das faturas que ainda não foram lidas (as antigas e as que falharam na Receção).
function ReadPending({ pending }) {
  const { upsertLocal, reload } = useData()
  const [run, setRun] = useState(null) // { total, done, linhas, erros: [] }
  const stop = useRef(false)
  if (!pending.length && !run) return null

  async function start() {
    stop.current = false
    const queue = [...pending].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    const state = { total: queue.length, done: 0, linhas: 0, erros: [] }
    setRun({ ...state })
    const worker = async () => {
      while (queue.length && !stop.current) {
        const inv = queue.shift()
        const res = await readStoredInvoiceLines(inv)
        state.done++
        if (res.error) {
          state.erros.push(`${inv.fornecedor || 'Sem fornecedor'} ${inv.data ? formatDate(inv.data) : ''}: ${res.error}`)
          if (res.desligada) stop.current = true
        } else {
          state.linhas += res.linhas.length
          upsertLocal('invoices', res.invoice)
        }
        setRun({ ...state, erros: [...state.erros] })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    reload('invoice_lines')
    setRun(r => ({ ...r, fim: true }))
  }

  const busy = run && !run.fim
  return (
    <Panel title="🔎 Ler artigos das faturas" hint="Lê as fotos e PDF já guardados e grava os artigos de cada fatura. As novas faturas da Receção já chegam com os artigos lidos. Cada leitura gasta um pouco de crédito da Anthropic; deixa esta página aberta até acabar.">
      {!run && <p>{pending.length} fatura(s) com ficheiros ainda por ler.</p>}
      {run && (
        <p>
          {run.fim ? 'Terminado' : 'A ler…'} {run.done} de {run.total} fatura(s) · {run.linhas} artigo(s) gravado(s)
          {run.erros.length > 0 && ` · ${run.erros.length} com erro`}
        </p>
      )}
      {run?.erros.length > 0 && <details><summary>Ver erros</summary><ul className="small">{run.erros.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
      <div className="actions">
        {busy
          ? <button className="secondary" onClick={() => { stop.current = true }}>Parar</button>
          : pending.length > 0 && <button className="primary" onClick={start}>Ler {pending.length} fatura(s)</button>}
      </div>
    </Panel>
  )
}
