import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import FilterBar from '../components/FilterBar'
import { Empty, Panel } from '../components/ui'
import { useFinance } from '../data/useFinance'
import { applyFilters, byCategory, byMonth, byProduct, byProperty, bySupplier, lineMonth, supplierKey } from '../lib/finance'
import { euro, numberPt } from '../lib/money'
import { monthLabel, monthOf, monthShort } from '../lib/dates'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

const TABS = [
  { id: 'fornecedor', label: 'Fornecedor' },
  { id: 'categoria', label: 'Categoria' },
  { id: 'produto', label: 'Produto' },
  { id: 'imovel', label: 'Imóvel' },
]

export default function Analise() {
  const { rows, all, filters, invoice_lines, invoices } = useFinance()
  const [tab, setTab] = useState('fornecedor')
  const [selected, setSelected] = useState(null)
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices])

  const groups = useMemo(() => {
    if (tab === 'fornecedor') return bySupplier(rows)
    if (tab === 'categoria') return byCategory(rows)
    if (tab === 'imovel') return byProperty(rows)
    const lines = invoice_lines.filter(l => !filters.month || lineMonth(l, invoicesById) === filters.month)
    return byProduct(lines).map(p => ({ nome: p.produto, categoria: p.tipo, count: p.count, total: p.valor ?? 0, quantidade: p.quantidade, unidade: p.unidade, porConsolidar: p.porConsolidar }))
  }, [tab, rows, invoice_lines, filters.month, invoicesById])

  const keyOf = useMemo(() => ({
    fornecedor: r => supplierKey(r).nome,
    categoria: r => r.categoria,
    imovel: r => r.imovel,
  })[tab], [tab])

  // Evolução mensal da linha selecionada (ignora o filtro de mês para mostrar a tendência).
  const evolution = useMemo(() => {
    if (!selected || tab === 'produto') return null
    const base = applyFilters(all, { ...filters, month: '' }).filter(r => keyOf(r) === selected)
    const months = [...new Set(all.map(r => monthOf(r.data)))].filter(Boolean).sort()
    return byMonth(base, months).map(m => ({ ...m, label: `${monthShort(m.month)} ${m.month.slice(2, 4)}` }))
  }, [selected, tab, all, filters, keyOf])

  const grand = groups.reduce((a, g) => a + g.total, 0) || 1
  const exportCsv = () => downloadText(toCsv(
    tab === 'produto' ? ['Produto', 'Categoria', 'Linhas', 'Quantidade', 'Gasto'] : ['Nome', 'Categoria', 'Registos', 'CGD', 'Numerário', 'Total'],
    groups.map(g => (tab === 'produto' ? [g.nome, g.categoria, g.count, g.quantidade ?? '', decimalPt(g.total)] : [g.nome, g.categoria ?? '', g.count, decimalPt(g.cgd), decimalPt(g.numerario), decimalPt(g.total)])),
  ), `analise_${tab}.csv`)

  return (
    <>
      <FilterBar onExport={exportCsv} />
      <div className="tabs">
        {TABS.map(t => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setSelected(null) }}>{t.label}</button>)}
      </div>
      {evolution && (
        <Panel title={`Evolução mensal · ${selected}`} actions={<button className="link-btn" onClick={() => setSelected(null)}>Fechar</button>}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={evolution}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={60} tickFormatter={v => euro(v).replace(',00', '')} />
              <Tooltip formatter={(v, n) => [euro(v), n]} labelFormatter={(_, p) => (p?.[0] ? monthLabel(p[0].payload.month) : '')} />
              <Bar dataKey="cgd" name="CGD" stackId="a" fill="#3864ec" />
              <Bar dataKey="numerario" name="Numerário" stackId="a" fill="#15905f" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}
      <Panel title={`Análise por ${TABS.find(t => t.id === tab).label.toLowerCase()}`} hint={tab === 'produto' ? 'Linhas de produtos das faturas. Valores por consolidar não entram no total.' : 'Despesas contabilísticas (CGD + numerário). Clica numa linha para ver a evolução mensal.'}>
        <div className="tablewrap tall">
          <table>
            <thead>
              {tab === 'produto'
                ? <tr><th>Produto</th><th>Categoria</th><th className="money">Linhas</th><th className="money">Quantidade</th><th className="money">Gasto</th><th className="money">%</th></tr>
                : <tr><th>{TABS.find(t => t.id === tab).label}</th>{tab === 'fornecedor' && <th>Categoria</th>}<th className="money">Registos</th><th className="money">CGD</th><th className="money">Numerário</th><th className="money">Total</th><th className="money">%</th></tr>}
            </thead>
            <tbody>
              {groups.length ? groups.map(g => (
                <tr key={g.nome} className={`clickable ${selected === g.nome ? 'row-selected' : ''}`} onClick={() => tab !== 'produto' && setSelected(g.nome)}>
                  <td><strong>{g.nome}</strong></td>
                  {tab === 'produto' ? (
                    <>
                      <td>{g.categoria}</td><td className="money">{g.count}</td>
                      <td className="money">{g.quantidade == null ? '—' : `${numberPt(g.quantidade, 3)} ${g.unidade || ''}`}</td>
                      <td className="money">{g.porConsolidar === g.count ? 'Por consolidar' : euro(g.total)}</td>
                    </>
                  ) : (
                    <>
                      {tab === 'fornecedor' && <td>{g.categoria}</td>}
                      <td className="money">{g.count}</td><td className="money">{euro(g.cgd)}</td><td className="money">{euro(g.numerario)}</td><td className="money"><strong>{euro(g.total)}</strong></td>
                    </>
                  )}
                  <td className="money muted">{numberPt((g.total / grand) * 100, 1)}%</td>
                </tr>
              )) : <Empty colSpan={7} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
