import FilterBar from '../components/FilterBar'
import { Badge, Empty, Panel } from '../components/ui'
import { useFinance } from '../data/useFinance'
import { byCategory } from '../lib/finance'
import { euro } from '../lib/money'
import { decimalPt, downloadText, toCsv } from '../lib/csv'

export default function Categorias() {
  const { rows } = useFinance()
  const cats = byCategory(rows)
  const exportCsv = () => downloadText(toCsv(['Categoria', 'CGD', 'Numerário', 'Total contabilístico'], cats.map(c => [c.nome, decimalPt(c.cgd), decimalPt(c.numerario), decimalPt(c.total)])), 'categorias.csv')
  return (
    <>
      <FilterBar onExport={exportCsv} />
      <Panel title="Despesas por categoria" hint="Separa o que saiu da CGD do que foi pago em numerário. O numerário conta como despesa contabilística e base de IVA, mas não é uma saída da CGD. Categorias marcadas como “não conta como despesa” (ex.: transferências entre empresas) ficam fora.">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Categoria</th><th className="money">Registos</th><th className="money">CGD · saída bancária</th><th className="money">Numerário · contabilístico</th><th className="money">Total contabilístico</th></tr></thead>
            <tbody>
              {cats.length ? cats.map(c => (
                <tr key={c.nome}><td><Badge>{c.nome}</Badge></td><td className="money">{c.count}</td><td className="money">{euro(c.cgd)}</td><td className="money">{euro(c.numerario)}</td><td className="money"><strong>{euro(c.total)}</strong></td></tr>
              )) : <Empty colSpan={5} />}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
