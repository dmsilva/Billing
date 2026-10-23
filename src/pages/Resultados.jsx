import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFinance } from '../data/useFinance'
import { useFilters } from '../data/FiltersProvider'
import { useMonthOptions } from '../components/FilterBar'
import { Kpi, Panel, Select } from '../components/ui'
import { yearResults } from '../lib/finance'
import { euro, parseMoney, sum } from '../lib/money'
import { monthLabel, monthShort } from '../lib/dates'

const euroAxis = v => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k €` : `${v} €`)
const tone = v => (v < 0 ? 'negative' : 'positive')

// Resultados: quanto faturámos, quanto gastámos e o que sobra, mês a mês e no ano.
export default function Resultados() {
  const { all, cash_closes, bank_credits } = useFinance()
  const { filters } = useFilters()
  const monthOptions = useMonthOptions()
  const years = useMemo(() => [...new Set(monthOptions.map(m => m.value.slice(0, 4)))].sort(), [monthOptions])
  const [year, setYear] = useState((filters.month || monthOptions.at(-1)?.value || String(new Date().getFullYear())).slice(0, 4))
  const [open, setOpen] = useState(null)
  const [bonusText, setBonusText] = useState('')
  const y = useMemo(() => yearResults(year, { closes: cash_closes, credits: bank_credits, expenseRows: all }), [year, cash_closes, bank_credits, all])
  const chart = y.months.map(m => ({ ...m, label: monthShort(m.month) }))
  const bonus = parseMoney(bonusText) || 0
  const depoisBonus = sum([y.resultado, -bonus])
  const avisos = y.completos.filter(m => m.semEntradasBanco)

  return (
    <div className="resultados">
      <div className="dash-welcome">
        <div>
          <div className="eyebrow">RESULTADOS</div>
          <h2>Faturado, despesas e lucro</h2>
          <p>Quanto entrou, quanto saiu e o que sobra, mês a mês e no ano.</p>
        </div>
        <div className="dash-month">
          <span>Ano</span>
          <Select value={year} onChange={setYear} options={years.length ? years : [year]} aria-label="Ano" />
        </div>
      </div>

      <div className="dash-kpis">
        <Kpi color="green" icon="↗" label={`Faturado em ${year}`} value={euro(y.faturado)} note="Caixa diária + entradas no banco" />
        <Kpi color="orange" icon="↘" label={`Despesas em ${year}`} value={euro(y.despesas)} note="Saídas CGD + pagamentos em numerário" />
        <Kpi color={y.resultado < 0 ? 'red' : 'blue'} icon="=" label={y.resultado < 0 ? 'Prejuízo do ano' : 'Lucro do ano'} value={euro(y.resultado)} note={y.faturado ? `Margem de ${Math.round((y.resultado / y.faturado) * 100)}%` : 'Sem faturado registado'} />
        <Kpi color="purple" icon="!" label="Meses com prejuízo" value={`${y.mesesComPrejuizo.length} de ${y.completos.length}`} note={y.mesesComPrejuizo.map(monthShort).join(', ') || 'Nenhum'} />
      </div>

      {y.incompletos.length > 0 && (
        <div className="notice warn">
          Os totais do ano contam só os meses com caixa diária e extrato da CGD importados ({y.completos.map(m => monthShort(m.month)).join(', ') || 'nenhum ainda'}). Sem resultado por falta de dados: {y.incompletos.map(m => `${monthShort(m.month)} (${m.semCaixa ? 'falta a caixa diária' : 'falta o extrato da CGD'})`).join(' · ')}. Importa o extrato desses meses em CGD / Extrato para os incluir.
        </div>
      )}
      {avisos.length > 0 && (
        <div className="notice warn">Sem entradas do banco importadas em {avisos.map(m => monthShort(m.month)).join(', ')}: Expedia, Booking e transferências desses meses ainda não estão no faturado.</div>
      )}

      <Panel title="Mês a mês" hint="Verde = faturado · laranja = despesas">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5eaf2" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71809a' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={euroAxis} tick={{ fontSize: 10, fill: '#71809a' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v, n) => [euro(v), n]} labelFormatter={(_, p) => (p?.[0] ? monthLabel(p[0].payload.month) : '')} cursor={{ fill: '#eef3ff' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="faturado" name="Faturado" fill="#15905f" radius={[6, 6, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill="#f28b31" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="tablewrap">
          <table className="mini-table result-table">
            <thead><tr><th>Mês</th><th className="money">Caixa diária</th><th className="money">Entradas no banco</th><th className="money">Faturado</th><th className="money">Despesas</th><th className="money">Resultado</th></tr></thead>
            <tbody>
              {y.comDados.length ? y.comDados.map(m => (
                <MonthRows key={m.month} m={m} open={open === m.month} onToggle={() => setOpen(open === m.month ? null : m.month)} />
              )) : <tr><td colSpan={6} className="emptybox">Sem dados neste ano.</td></tr>}
            </tbody>
            {y.comDados.length > 0 && (
              <tfoot><tr><th>Total {year}{y.incompletos.length > 0 && <div className="muted small">só meses completos</div>}</th><th className="money">{euro(sum(y.completos.map(m => m.caixa.total)))}</th><th className="money">{euro(sum(y.completos.map(m => m.banco)))}</th><th className="money">{euro(y.faturado)}</th><th className="money">{euro(y.despesas)}</th><th className={`money ${tone(y.resultado)}`}>{euro(y.resultado)}</th></tr></tfoot>
            )}
          </table>
        </div>
        <div className="hint">Clica num mês para ver o detalhe.</div>
      </Panel>

      <div className="twocol">
        <Panel title="Bónus de fim de ano" hint="Simula quanto podes pagar sem ficar em prejuízo.">
          <div className="bonus-grid">
            <div><span>Resultado do ano até agora</span><strong className={tone(y.resultado)}>{euro(y.resultado)}</strong></div>
            <div><span>Salários pagos no ano</span><strong>{euro(y.salarios)}</strong></div>
            <label><span>Bónus a pagar</span><input inputMode="decimal" value={bonusText} onChange={e => setBonusText(e.target.value)} placeholder="Ex.: 3000" /></label>
            <div><span>Resultado depois do bónus</span><strong className={tone(depoisBonus)}>{euro(depoisBonus)}</strong></div>
          </div>
          <div className="hint">
            {y.resultado <= 0
              ? 'Neste momento o ano está em prejuízo: um bónus aumentaria o prejuízo.'
              : bonus > 0
                ? `O bónus representa ${Math.round((bonus / y.resultado) * 100)}% do lucro${y.salarios ? ` e ${Math.round((bonus / y.salarios) * 100)}% dos salários do ano` : ''}.`
                : 'Escreve um valor para ver como fica o resultado.'}
            {' '}Conta só com os meses já registados.
          </div>
        </Panel>
        <Panel title="Como é calculado">
          <ul className="calc-list">
            <li><strong>Faturado</strong> = tudo o que a receção registou na caixa diária (dinheiro, CV, MB, City MB) + entradas no banco que não passam pela caixa (Expedia, Booking, Airbnb, Stripe, transferências de hóspedes).</li>
            <li>Os créditos <strong>TPA / Multibanco</strong> e os <strong>depósitos</strong> não contam outra vez: são o dinheiro da caixa a chegar ao banco. As entradas marcadas como “não conta” também ficam fora.</li>
            <li><strong>Despesas</strong> = saídas da conta CGD (sem transferências entre empresas) + faturas pagas em numerário. Faturas pagas por CGD não somam outra vez.</li>
            <li><strong>Resultado</strong> = faturado − despesas. Negativo quer dizer prejuízo nesse mês.</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function MonthRows({ m, open, onToggle }) {
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td><strong>{open ? '▾' : '▸'} {monthLabel(m.month)}</strong>{!m.completo ? <span className="badge pending">{m.semCaixa ? 'falta a caixa' : 'falta o extrato'}</span> : m.semEntradasBanco && <span className="badge pending">sem entradas do banco</span>}</td>
        <td className="money">{euro(m.caixa.total)}</td>
        <td className="money">{euro(m.banco)}</td>
        <td className="money"><strong>{euro(m.faturado)}</strong></td>
        <td className="money">{euro(m.despesas)}</td>
        <td className={`money ${m.completo ? tone(m.resultado) : 'muted'}`}>{m.completo ? <strong>{euro(m.resultado)}</strong> : 'incompleto'}</td>
      </tr>
      {open && (
        <tr className="result-detail"><td colSpan={6}>
          <div className="result-detail-grid">
            <div>
              <div className="subhead">Caixa diária ({m.caixa.dias} dias)</div>
              <Line label="Recebido em numerário" v={m.caixa.dinheiro} />
              <Line label="MB + City MB" v={m.caixa.cartoes} />
              <Line label="CV" v={m.caixa.cv} />
            </div>
            <div>
              <div className="subhead">Entradas no banco</div>
              {m.bancoPorTipo.length ? m.bancoPorTipo.map(t => <Line key={t.tipo} label={t.tipo} v={t.total} />) : <div className="muted small">{m.semEntradasBanco ? 'Extrato com entradas ainda não importado.' : 'Sem entradas a somar.'}</div>}
              {m.foraDoFaturado > 0 && <div className="muted small">Não somados (TPA, depósitos e outros): {euro(m.foraDoFaturado)}</div>}
            </div>
            <div>
              <div className="subhead">Despesas</div>
              <Line label="Saídas CGD" v={m.despesasCgd} />
              <Line label="Pagas em numerário" v={m.despesasNumerario} />
              <Line label="das quais salários" v={m.salarios} />
            </div>
          </div>
        </td></tr>
      )}
    </>
  )
}

const Line = ({ label, v }) => <div className="result-line"><span>{label}</span><strong>{euro(v)}</strong></div>
