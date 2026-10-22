import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../auth/AuthProvider'
import { useFinance } from '../data/useFinance'
import { useFilters } from '../data/FiltersProvider'
import FilterBar, { useMonthOptions } from '../components/FilterBar'
import { Kpi, Panel, RankBars, Select, StateBadge } from '../components/ui'
import { attentionCounts, bankCredits, breakfastAnalysis, byCategory, byMonth, byProperty, bySupplier, cashEntries, cashCloseTotal, lineMonth, totals } from '../lib/finance'
import { euro, sum } from '../lib/money'
import { formatDate, monthLabel, monthOf, monthShort, monthsOfYear } from '../lib/dates'

export const PALETTE = ['#3b6bea', '#ef6a73', '#f2b84b', '#f28b31', '#68769a', '#5bb58b', '#a9a0a9', '#7351cf']
const euroAxis = v => (v >= 1000 ? `${Math.round(v / 1000)}k €` : `${v} €`)

export default function Dashboard() {
  const { profile } = useAuth()
  const fin = useFinance()
  const { filters, set } = useFilters()
  const nav = useNavigate()
  const monthOptions = useMonthOptions()
  const { rows, closes, all, invoices, invoice_lines, cash_closes, cash_checks, bankRows, bank_credits } = fin

  const year = (filters.month || monthOptions.at(-1)?.value || String(new Date().getFullYear())).slice(0, 4)
  const t = totals(rows)
  const entries = cashEntries(closes)
  const credits = bankCredits(bank_credits, filters.month)

  const monthly = useMemo(() => {
    const months = monthsOfYear(year)
    const noMonth = { ...filters, month: '' }
    const base = all.filter(r => (!noMonth.property || r.imovel === noMonth.property) && (!noMonth.payment || r.pagamento === noMonth.payment) && (!noMonth.category || r.categoria === noMonth.category))
    const spend = byMonth(base, months)
    return spend.map(m => ({
      ...m,
      label: monthShort(m.month),
      entradas: sum(cash_closes.filter(c => monthOf(c.data) === m.month).map(cashCloseTotal)),
      banco: bankCredits(bank_credits, m.month).total,
    }))
  }, [all, cash_closes, bank_credits, year, filters])

  const cats = byCategory(rows)
  const top = cats.slice(0, 7)
  const othersTotal = sum(cats.slice(7).map(c => c.total))
  const donut = othersTotal > 0 ? [...top, { nome: 'Outras', total: othersTotal }] : top

  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices])
  const lines = invoice_lines.filter(l => !filters.month || lineMonth(l, invoicesById) === filters.month)
  const breakfast = breakfastAnalysis(lines)
  const recent = [...invoices].filter(i => !filters.month || monthOf(i.data) === filters.month).sort((a, b) => String(b.data || b.created_at).localeCompare(String(a.data || a.created_at))).slice(0, 6)
  const attention = attentionCounts({ rows: bankRows, invoices, closes: cash_closes, checks: cash_checks, month: filters.month })
  const props = byProperty(rows)
  const suppliers = bySupplier(rows).slice(0, 10)

  return (
    <div className="dashboard-overview">
      <div className="dash-welcome">
        <div>
          <div className="eyebrow">GESTÃO FINANCEIRA</div>
          <h2>Olá, {profile?.nome || 'Patrícia'} <span>👋</span></h2>
          <p>Um resumo simples da situação financeira da empresa.</p>
        </div>
        <div className="dash-month">
          <span>Período</span>
          <Select value={filters.month} onChange={v => set({ month: v })} options={monthOptions} placeholder="Todos os meses" aria-label="Período" />
        </div>
      </div>

      <FilterBar />

      <div className="dash-kpis">
        <Kpi color="blue" icon="€" label="Despesas CGD" value={euro(t.cgd)} note="Saídas da conta bancária" />
        <Kpi color="green" icon="€" label="Numerário" value={euro(t.numerario)} note="Despesa contabilística" />
        <Kpi color="purple" icon="Σ" label="Total contabilístico" value={euro(t.total)} note="CGD + numerário" />
        <Kpi color="orange" icon="↗" label="Entradas de caixa" value={euro(entries.total)} note="Caixa diária" />
        <Kpi color="green" icon="↘" label="Entradas no banco" value={euro(credits.total)} note="Expedia, Stripe, transferências" />
      </div>

      <div className="dash-grid top-charts">
        <Panel title="Gastos por mês" hint={`Despesas contabilísticas e entradas · clica num mês para o analisar`} actions={<span className="chart-caption">{year}</span>}>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly} onClick={e => e?.activePayload?.[0] && set({ month: e.activePayload[0].payload.month })}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={euroAxis} tick={{ fontSize: 10, fill: '#71809a' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v, n) => [euro(v), n]} labelFormatter={(_, p) => (p?.[0] ? monthLabel(p[0].payload.month) : '')} cursor={{ fill: '#eef3ff' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="cgd" name="CGD" stackId="d" fill="#3864ec" radius={[0, 0, 2, 2]} cursor="pointer">
                  {monthly.map(m => <Cell key={m.month} fillOpacity={!filters.month || filters.month === m.month ? 1 : 0.45} />)}
                </Bar>
                <Bar dataKey="numerario" name="Numerário" stackId="d" fill="#15905f" radius={[6, 6, 0, 0]} cursor="pointer">
                  {monthly.map(m => <Cell key={m.month} fillOpacity={!filters.month || filters.month === m.month ? 1 : 0.45} />)}
                </Bar>
                <Bar dataKey="entradas" name="Entradas de caixa" fill="#f2b84b" radius={[6, 6, 0, 0]} cursor="pointer" />
                <Bar dataKey="banco" name="Entradas no banco" fill="#5bb58b" radius={[6, 6, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Gastos por categoria" hint="Distribuição do período">
          <div className="donut-wrap">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donut} dataKey="total" nameKey="nome" innerRadius={58} outerRadius={92} paddingAngle={1} onClick={d => d?.nome !== 'Outras' && set({ category: d.nome })} cursor="pointer">
                    {donut.map((c, i) => <Cell key={c.nome} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => euro(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{euro(t.total)}</strong><span>Total</span></div>
            </div>
            <div className="legend">
              {donut.length ? donut.map((c, i) => (
                <div className="legend-row" key={c.nome}>
                  <i className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="legend-name" title={c.nome}>{c.nome}</span>
                  <strong className="legend-value">{euro(c.total)}</strong>
                </div>
              )) : <div className="emptybox">Sem despesas.</div>}
            </div>
          </div>
        </Panel>
      </div>

      <div className="dash-grid middle-grid">
        <Panel title="Faturas recentes" hint="Últimos documentos registados" actions={<Link className="link-btn" to="/faturas">Ver todas →</Link>}>
          {recent.length ? (
            <div className="recent-table">
              <div className="recent-row header"><span>Data</span><span>Fornecedor</span><span>Pagamento</span><span>Valor</span><span>Estado</span></div>
              {recent.map(i => (
                <div className="recent-row clickable" key={i.id} onClick={() => nav(`/faturas/${i.id}`)}>
                  <span>{formatDate(i.data)}</span>
                  <span className="supplier">{i.fornecedor || '—'}</span>
                  <span>{i.pagamento}</span>
                  <span className="amount">{i.valor == null ? '—' : euro(i.valor)}</span>
                  <span><StateBadge value={i.estado} /></span>
                </div>
              ))}
            </div>
          ) : <div className="emptybox">Sem documentos neste período.</div>}
        </Panel>
        <Panel title="☕ Pequeno-almoço" hint="Produtos já identificados nas faturas" actions={<Link className="link-btn" to="/produtos">Ver detalhes →</Link>}>
          <div className="breakfast-hero"><span>Total identificado</span><strong>{euro(breakfast.total)}</strong></div>
          <RankBars rows={breakfast.items.slice(0, 5).map(i => ({ label: i.produto, value: Number(i.valor) }))} empty="Ainda não existem produtos identificados." />
        </Panel>
      </div>

      <div className="dash-grid bottom-grid">
        <Panel title="⚠ Precisa da tua atenção" hint="Itens que merecem revisão" className="attention-panel">
          <AttentionItem icon="▤" to="/recebidas" title={`${attention.porValidar} faturas por validar`} text="Documentos registados no período" />
          {attention.porLiquidar > 0 && <AttentionItem icon="🕓" tone="amber" to="/por-liquidar" title={`${attention.porLiquidar} faturas por liquidar`} text="Registadas como por pagar" />}
          <AttentionItem icon="€" tone="amber" to="/conferencia" title={`${attention.caixasPorConferir} caixas por conferir`} text="Fechos ainda sem conferência completa" />
          <AttentionItem icon="≠" tone="red" to="/conferencia" title={`${attention.diferencas} diferenças na conferência`} text="Valores reais diferentes do esperado" />
          <AttentionItem icon="?" tone="gray" to="/editar-categorias?filtro=por-classificar" title={`${attention.porClassificar} movimentos por classificar`} text="No extrato CGD" />
        </Panel>
        <Panel title="Resumo por local" hint="Despesas contabilísticas">
          <div className="location-table">
            <div className="loc-row head"><span>Local</span><span className="money">CGD</span><span className="money">Numerário</span><span className="money">Total</span></div>
            {props.length ? props.map(p => (
              <div className="loc-row" key={p.nome}><span>{p.nome}</span><span className="money">{euro(p.cgd)}</span><span className="money">{euro(p.numerario)}</span><strong className="money">{euro(p.total)}</strong></div>
            )) : <div className="emptybox">Sem dados.</div>}
          </div>
        </Panel>
      </div>

      <section className="panel" id="detalhe">
        <h2>{filters.month ? `Análise detalhada — ${monthLabel(filters.month)}` : 'Análise detalhada do período'}</h2>
        <div className="detail-note">
          Aqui separas tesouraria de contabilidade: {euro(t.cgd)} pagos por CGD + {euro(t.numerario)} pagos em numerário = {euro(t.total)} de despesa contabilística. Transferências entre empresas ficam fora destes totais.
        </div>
        <div className="detail-grid">
          <div className="detail-card"><div className="label">Total de saídas</div><div className="big">{euro(t.total)}</div></div>
          <div className="detail-card"><div className="label">Maior categoria</div><div className="big small">{cats[0] ? `${cats[0].nome} · ${euro(cats[0].total)}` : '—'}</div></div>
          <div className="detail-card"><div className="label">Maior fornecedor</div><div className="big small">{suppliers[0] ? `${suppliers[0].nome} · ${euro(suppliers[0].total)}` : '—'}</div></div>
          <div className="detail-card"><div className="label">Entradas de caixa</div><div className="big">{euro(entries.total)}</div></div>
          <div className="detail-card"><div className="label">Entradas no banco</div><div className="big">{euro(credits.total)}</div></div>
        </div>
        <div className="twocol">
          <Panel title="Onde está a sair o dinheiro?">
            <RankBars rows={cats.map(c => ({ label: c.nome, value: c.total }))} empty="Sem despesas neste período." onClick={r => set({ category: r.label })} />
          </Panel>
          <Panel title="Maiores fornecedores">
            <div className="tablewrap"><table className="mini-table"><thead><tr><th>Fornecedor / movimento</th><th>Categoria</th><th className="money">Valor</th></tr></thead>
              <tbody>{suppliers.length ? suppliers.map(s => <tr key={s.nome}><td><strong>{s.nome}</strong></td><td>{s.categoria}</td><td className="money">{euro(s.total)}</td></tr>) : <tr><td colSpan={3} className="emptybox">Sem despesas.</td></tr>}</tbody>
            </table></div>
          </Panel>
        </div>
        <div className="twocol">
          <Panel title="Por imóvel">
            <div className="tablewrap"><table className="mini-table"><thead><tr><th>Imóvel</th><th className="money">CGD</th><th className="money">Numerário</th><th className="money">Total contabilístico</th></tr></thead>
              <tbody>{props.map(p => <tr key={p.nome}><td>{p.nome}</td><td className="money">{euro(p.cgd)}</td><td className="money">{euro(p.numerario)}</td><td className="money"><strong>{euro(p.total)}</strong></td></tr>)}</tbody>
            </table></div>
          </Panel>
          <Panel title="Pequeno-almoço" hint="Calculado linha a linha a partir dos produtos identificados nas faturas.">
            {breakfast.items.length ? (
              <>
                <div className="breakfast-total"><span>Total identificado de pequeno-almoço</span><strong>{euro(breakfast.total)}</strong></div>
                <div className="subhead">Por fornecedor</div>
                <RankBars rows={breakfast.suppliers.map(s => ({ label: s.nome, value: s.total }))} max={breakfast.total || 1} />
                <div className="subhead">Produtos com maior gasto</div>
                <RankBars rows={breakfast.items.slice(0, 12).map(i => ({ label: i.produto, value: Number(i.valor) }))} />
                <div className="hint">Os valores são os que já foram lidos das linhas das faturas; linhas ilegíveis ou ainda não consolidadas não são inventadas.</div>
              </>
            ) : <div className="emptybox">Ainda não existem linhas de produtos identificadas para este período.</div>}
          </Panel>
        </div>
      </section>
    </div>
  )
}

function AttentionItem({ icon, title, text, to, tone }) {
  return (
    <Link className="attention-item" to={to}>
      <div className={`attention-icon ${tone || ''}`}>{icon}</div>
      <div><strong>{title}</strong><span>{text}</span></div>
      <div className="attention-arrow">›</div>
    </Link>
  )
}
