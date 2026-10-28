import { useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { gerarOrdenados, lerMesesDoFicheiro, MESES } from '../lib/ordenados'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const nomeMes = (ano, mes) => `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} ${ano}`

function descarregar(buffer, nome) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }))
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Ordenados() {
  const toast = useToast()
  const [horario, setHorario] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [meses, setMeses] = useState([])
  const [mes, setMes] = useState('')
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function escolherHorario(file) {
    setHorario(file); setResultado(null)
    try {
      const lista = await lerMesesDoFicheiro(file)
      setMeses(lista)
      const hoje = new Date()
      const atual = lista.find(m => m.ano === hoje.getFullYear() && m.mes === hoje.getMonth() + 1) || lista[lista.length - 1]
      setMes(atual ? `${atual.ano}-${atual.mes}` : '')
      if (!lista.length) toast('Este Excel não tem folhas com o nome do mês (ex.: "Outubro 2026").', 'bad')
    } catch (e) { setMeses([]); toast(`Não consegui ler o horário: ${e.message}`, 'bad') }
  }

  async function gerar() {
    const [ano, m] = mes.split('-').map(Number)
    setBusy(true)
    try {
      const r = await gerarOrdenados(horario, ordenados, ano, m)
      const nome = `${ordenados.name.replace(/\.xlsx$/i, '')}_${nomeMes(ano, m).replace(' ', '_')}.xlsx`
      descarregar(r.buffer, nome)
      setResultado({ ...r, ano, mes: m, nome })
      toast(`Ficheiro ${nome} criado.`)
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  const r = resultado
  return (
    <>
      <Panel title="Ordenados para a contabilidade" hint="Envia o horário dos funcionários e o Excel dos ordenados. A folha “para contabilidade” é preenchida com os feriados trabalhados, as noites (23h às 7h), os dias de férias (azul) e, nas notas, as faltas justificadas (vermelho). O resto do Excel fica igual.">
        <div className="actions">
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => e.target.files[0] && escolherHorario(e.target.files[0])} />{horario ? `Horário: ${horario.name}` : '1. Escolher o horário (Funcionários)'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setOrdenados(e.target.files[0]); setResultado(null) } }} />{ordenados ? `Ordenados: ${ordenados.name}` : '2. Escolher o Excel dos ordenados'}</label>
          {meses.length > 0 && (
            <select value={mes} onChange={e => { setMes(e.target.value); setResultado(null) }} aria-label="Mês">
              {meses.map(x => <option key={x.folha} value={`${x.ano}-${x.mes}`}>{nomeMes(x.ano, x.mes)}</option>)}
            </select>
          )}
          <button className="primary" disabled={busy || !horario || !ordenados || !mes} onClick={gerar}>{busy ? 'A preencher…' : 'Preencher e descarregar'}</button>
        </div>
      </Panel>
      {r && (
        <Panel title={`Resumo de ${nomeMes(r.ano, r.mes)}`} hint={`Folha “${r.folhaHorario}” do horário. Cada noite conta no dia em que começa; o feriado conta quando há horário nesse dia.`}
          actions={<button className="secondary" onClick={() => descarregar(r.buffer, r.nome)}>Descarregar outra vez</button>}>
          {r.semPar.length > 0 && (
            <div className="notice warn">
              Não estão na folha da contabilidade, por isso ficaram de fora: {r.semPar.map(f => `${f.nome} (${[
                f.feriados.length && `${f.feriados.length} feriado`, f.noites && `${f.noites} noites`, f.ferias.length && `${f.ferias.length} dias de férias`, f.faltas.length && `${f.faltas.length} faltas`,
              ].filter(Boolean).join(', ')})`).join('; ')}.
            </div>
          )}
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Nome</th><th className="money">Feriados</th><th className="money">Noites</th><th className="money">Férias</th><th className="money">Faltas just.</th></tr></thead>
            <tbody>{r.resumo.length ? r.resumo.map(f => (
              <tr key={f.nome}><td>{f.nomeContabilidade}</td><td className="money">{f.feriados.length || ''}</td><td className="money">{f.noites || ''}</td><td className="money">{f.ferias.length || ''}</td><td className="money">{f.faltas.length || ''}</td></tr>
            )) : <Empty colSpan={5}>Nenhum funcionário do horário corresponde à folha da contabilidade.</Empty>}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  )
}
