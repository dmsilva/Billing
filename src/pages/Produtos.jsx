import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../data/DataProvider'
import { useFilters } from '../data/FiltersProvider'
import { Badge, Empty, Kpi, Panel, RankBars, Select } from '../components/ui'
import { breakfastAnalysis, byProductType, lineIsClosed, lineMonth, lineSupplier } from '../lib/finance'
import { euro, numberPt, sumBy } from '../lib/money'
import { decimalPt, downloadText, toCsv } from '../lib/csv'
import { useMonthOptions } from '../components/FilterBar'

export default function Produtos() {
  const { invoice_lines, invoices } = useData()
  const { filters, set } = useFilters()
  const months = useMonthOptions()
  const [tipo, setTipo] = useState('')
  const [q, setQ] = useState('')
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices])
  const inPeriod = invoice_lines.filter(l => !filters.month || lineMonth(l, invoicesById) === filters.month)
  const types = [...new Set(invoice_lines.map(l => l.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'))
  const rows = inPeriod
    .filter(l => (!tipo || l.tipo === tipo) && (!q.trim() || `${l.produto} ${l.tipo} ${l.observacao} ${l.fornecedor}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (Number(b.valor) || -1) - (Number(a.valor) || -1))
  const closed = inPeriod.filter(lineIsClosed)
  const find = re => inPeriod.find(l => re.test(l.produto))
  const butter = find(/^manteiga/i)
  const detergent = find(/^detergente/i)
  const breakfast = breakfastAnalysis(inPeriod)

  const exportCsv = () => downloadText(toCsv(['Produto', 'Unidade', 'Quantidade', 'Gasto', 'Categoria', 'Fornecedor', 'Estado', 'Observação'],
    rows.map(l => [l.produto, l.unidade, l.quantidade == null ? '' : String(l.quantidade).replace('.', ','), decimalPt(l.valor), l.tipo, lineSupplier(l) || '', lineIsClosed(l) ? 'Fechado' : 'Por consolidar', l.observacao])), 'produtos.csv')

  return (
    <>
      <Panel title="Consumo por produto" hint="Artigos identificados dentro das faturas e recibos. O croissant mini manteiga não é contado como compra de manteiga.">
        <div className="grid4">
          <Kpi color="blue" icon="€" label="Gasto identificado" value={euro(sumBy(closed, l => l.valor))} />
          <Kpi color="green" icon="◌" label="Produtos" value={inPeriod.length} note={`${inPeriod.length - closed.length} por consolidar`} />
          <Kpi color="orange" icon="🧈" label="Manteiga" value={butter?.valor != null ? euro(butter.valor) : 'Por consolidar'} />
          <Kpi color="purple" icon="🧴" label="Detergentes" value={detergent?.valor != null ? euro(detergent.valor) : 'Por consolidar'} />
        </div>
      </Panel>
      <div className="twocol">
        <Panel title="Por categoria de produto"><RankBars rows={byProductType(rows).map(t => ({ label: t.nome, value: t.total }))} onClick={r => setTipo(r.label)} /></Panel>
        <Panel title="☕ Pequeno-almoço por fornecedor" hint={`Total identificado: ${euro(breakfast.total)}`}>
          <RankBars rows={breakfast.suppliers.map(s => ({ label: s.nome, value: s.total }))} max={breakfast.total || 1} />
          <div className="hint">Entram alimentos, laticínios, fruta e bebidas não alcoólicas. Detergentes, consumíveis e álcool ficam fora.</div>
        </Panel>
      </div>
      <Panel>
        <div className="filters flat">
          <Select value={filters.month} onChange={v => set({ month: v })} options={months} placeholder="Todos os meses" />
          <Select value={tipo} onChange={setTipo} options={types} placeholder="Todas as categorias" />
          <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar produto…" />
          <button className="secondary" onClick={exportCsv}>Exportar produtos CSV</button>
        </div>
        <div className="tablewrap tall">
          <table>
            <thead><tr><th>Produto</th><th>Unidade</th><th className="money">Quantidade</th><th className="money">Gasto</th><th>Categoria</th><th>Fornecedor</th><th>Estado</th><th>Observação</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(l => (
                <tr key={l.id}>
                  <td><strong>{l.produto}</strong>{l.invoice_id && <div className="small"><Link to={`/faturas/${l.invoice_id}`}>ver fatura</Link></div>}</td>
                  <td>{l.unidade}</td>
                  <td className="money">{l.quantidade == null ? '—' : numberPt(l.quantidade, 3)}</td>
                  <td className="money">{l.valor == null ? '—' : euro(l.valor)}</td>
                  <td><Badge>{l.tipo}</Badge></td>
                  <td>{lineSupplier(l) || '—'}</td>
                  <td>{lineIsClosed(l) ? <Badge tone="ok">Fechado</Badge> : <Badge tone="pending">Por consolidar</Badge>}</td>
                  <td className="wrap muted">{l.observacao}</td>
                </tr>
              )) : <Empty colSpan={8}>Sem produtos para este filtro.</Empty>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
