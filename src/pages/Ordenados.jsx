import { useEffect, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { gerarExcel, gerarPdf, lerMesesDoFicheiro, lerOrdenados, MESES, nomeMes } from '../lib/ordenados'
import { conferirRecibos, lerRecibos, preencherFolhaBanco } from '../lib/recibos'
import { euro } from '../lib/money'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function descarregar(buffer, nome, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buffer], { type }))
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const resumoDias = l => (l.length ? `${l.join(', ')}` : '')

export default function Ordenados() {
  const toast = useToast()
  const [horario, setHorario] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [meses, setMeses] = useState([])
  const [mes, setMes] = useState('')
  const [busy, setBusy] = useState(false)
  const [dados, setDados] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [recibos, setRecibos] = useState(null)

  async function escolherHorario(file) {
    setHorario(file); setDados(null)
    try {
      const lista = await lerMesesDoFicheiro(file)
      setMeses(lista)
      const hoje = new Date()
      const atual = lista.find(m => m.ano === hoje.getFullYear() && m.mes === hoje.getMonth() + 1) || lista[lista.length - 1]
      setMes(atual ? `${atual.ano}-${atual.mes}` : '')
      if (!lista.length) toast('Este Excel não tem folhas com o nome do mês (ex.: "Outubro 2026").', 'bad')
    } catch (e) { setMeses([]); toast(`Não consegui ler o horário: ${e.message}`, 'bad') }
  }

  useEffect(() => {
    if (!horario || !ordenados || !mes) return
    let ativo = true
    const [ano, m] = mes.split('-').map(Number)
    setBusy(true)
    lerOrdenados(horario, ordenados, ano, m)
      .then(d => { if (ativo) setDados(d) })
      .catch(e => { if (ativo) { setDados(null); toast(e.message, 'bad') } })
      .finally(() => { if (ativo) setBusy(false) })
    return () => { ativo = false }
  }, [horario, ordenados, mes, toast])

  useEffect(() => {
    if (!pdf) return
    let ativo = true
    lerRecibos(pdf)
      .then(r => { if (ativo) setRecibos(r) })
      .catch(e => { if (ativo) { setRecibos(null); toast(`Não consegui ler o PDF: ${e.message}`, 'bad') } })
    return () => { ativo = false }
  }, [pdf, toast])

  const conferencia = dados && recibos ? conferirRecibos(recibos, dados.linhas) : null
  const comProblemas = conferencia ? conferencia.linhas.filter(l => l.problemas.length) : []

  async function baixarFolhaBanco() {
    setBusy(true)
    try {
      const mesNome = MESES[dados.mes - 1][0].toUpperCase() + MESES[dados.mes - 1].slice(1)
      const { ficheiro, semRecibo } = await preencherFolhaBanco(await ordenados.arrayBuffer(), recibos, mesNome)
      descarregar(ficheiro, `Ordenados_Chalet_${mesNome}_${dados.ano}.xlsx`, XLSX_TYPE)
      if (semRecibo.length) toast(`Sem recibo, ficaram sem valor: ${semRecibo.join(', ')}.`, 'bad')
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  const setNota = (i, nota) => setDados(d => ({ ...d, linhas: d.linhas.map((l, k) => (k === i ? { ...l, nota } : l)) }))
  const base = dados ? `Ordenados_contabilidade_${nomeMes(dados.ano, dados.mes).replace(' ', '_')}` : ''

  async function baixar(tipo) {
    setBusy(true)
    try {
      if (tipo === 'pdf') descarregar(await gerarPdf(dados), `${base}.pdf`, 'application/pdf')
      else descarregar(await gerarExcel(dados), `${base}.xlsx`, XLSX_TYPE)
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  return (
    <>
      <Panel title="Ordenados para a contabilidade" hint="Envia o horário dos funcionários e o Excel dos ordenados. Contamos os feriados trabalhados, as noites (23h às 7h) e os dias de férias (azul). Escreve as notas que quiseres e descarrega em Excel ou PDF.">
        <div className="actions">
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => e.target.files[0] && escolherHorario(e.target.files[0])} />{horario ? `Horário: ${horario.name}` : '1. Escolher o horário (Funcionários)'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setOrdenados(e.target.files[0]); setDados(null) } }} />{ordenados ? `Ordenados: ${ordenados.name}` : '2. Escolher o Excel dos ordenados'}</label>
          {meses.length > 0 && (
            <select value={mes} onChange={e => { setMes(e.target.value); setDados(null) }} aria-label="Mês">
              {meses.map(x => <option key={x.folha} value={`${x.ano}-${x.mes}`}>{nomeMes(x.ano, x.mes)}</option>)}
            </select>
          )}
          {busy && !dados && <span className="muted">A ler…</span>}
        </div>
      </Panel>
      {dados && (
        <Panel title={`Ordenados de ${nomeMes(dados.ano, dados.mes)}`} hint={`Folha “${dados.folhaHorario}” do horário. Cada noite conta no dia em que começa. As faltas justificadas (vermelho) só aparecem aqui; se quiseres que vão para a contabilidade, escreve-as nas notas.`}
          actions={<>
            <button className="primary" disabled={busy} onClick={() => baixar('xlsx')}>Descarregar Excel</button>
            <button className="secondary" disabled={busy} onClick={() => baixar('pdf')}>Descarregar PDF</button>
          </>}>
          {dados.semPar.length > 0 && (
            <div className="notice warn">
              Estão no horário mas não na folha da contabilidade, por isso ficam de fora: {dados.semPar.map(f => f.nome).join(', ')}.
            </div>
          )}
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Código</th><th>Nome</th><th className="money">Feriados</th><th className="money">Noites</th><th className="money">Férias</th><th>Faltas justificadas</th><th>Notas</th></tr></thead>
            <tbody>{dados.linhas.length ? dados.linhas.map((l, i) => (
              <tr key={`${l.codigo}-${l.nome}`} className={l.noHorario ? '' : 'row-muted'}>
                <td>{l.codigo ?? ''}</td>
                <td>{l.nome}{!l.noHorario && <span className="muted small"> · não está no horário</span>}</td>
                <td className="money" title={resumoDias(l.feriados)}>{l.feriados.length || ''}</td>
                <td className="money">{l.noites || ''}</td>
                <td className="money" title={resumoDias(l.ferias)}>{l.ferias.length || ''}</td>
                <td>{l.faltas.length ? `${l.faltas.length} (dia ${resumoDias(l.faltas)})` : ''}</td>
                <td><input value={l.nota} onChange={e => setNota(i, e.target.value)} placeholder="Sem notas" aria-label={`Notas de ${l.nome}`} style={{ width: '100%', minWidth: 220 }} /></td>
              </tr>
            )) : <Empty colSpan={7}>A folha da contabilidade não tem funcionários.</Empty>}</tbody>
          </table></div>
        </Panel>
      )}
      {dados && (
        <Panel title="Recibos do contabilista" hint="Quando chegarem os recibos em PDF, envia-os aqui. Conferimos os feriados, as noites, as faltas e o vencimento base com o que foi enviado e preenchemos a folha Ordenados_Chalet com o valor pago, pronta para exportar em CSV para o banco."
          actions={recibos && <button className="primary" disabled={busy} onClick={baixarFolhaBanco}>Descarregar Ordenados_Chalet</button>}>
          <div className="actions">
            <label className="file-button"><input type="file" accept=".pdf" onChange={e => { if (e.target.files[0]) { setPdf(e.target.files[0]); setRecibos(null) } }} />{pdf ? `Recibos: ${pdf.name}` : '3. Escolher o PDF dos recibos'}</label>
          </div>
          {conferencia && (
            <>
              {comProblemas.length
                ? <div className="notice bad">O contabilista não bate certo em {comProblemas.length === 1 ? '1 pessoa' : `${comProblemas.length} pessoas`}: {comProblemas.map(l => l.linha.nome).join(', ')}.</div>
                : <div className="notice ok">Está tudo certo: feriados, noites, faltas e vencimentos batem com o que foi enviado.</div>}
              {conferencia.semLinha.length > 0 && <div className="notice warn">Recibos de quem não está na folha da contabilidade: {conferencia.semLinha.map(r => r.nome).join(', ')}.</div>}
              <div className="tablewrap"><table className="mini-table">
                <thead><tr><th>Nome</th><th className="money">Feriados</th><th className="money">Noites</th><th className="money">Faltas</th><th className="money">Venc. base</th><th className="money">Valor pago</th><th>Conferência</th></tr></thead>
                <tbody>{conferencia.linhas.map(({ linha, recibo, pago, problemas }) => (
                  <tr key={`${linha.codigo}-${linha.nome}`}>
                    <td>{linha.nome}</td>
                    <td className="money">{pago ? pago.feriados : ''}</td>
                    <td className="money">{pago ? (linha.nocturno ? '—' : pago.noites) : ''}</td>
                    <td className="money">{pago ? pago.faltas : ''}</td>
                    <td className="money">{pago?.vencimento != null ? euro(pago.vencimento) : ''}</td>
                    <td className="money">{recibo?.pago != null ? euro(recibo.pago) : ''}</td>
                    <td className={problemas.length ? 'bad' : 'ok'}>{problemas.length ? problemas.join(' ') : 'Certo'}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={5}>Total pago</td><td className="money">{euro(conferencia.total)}</td><td /></tr></tfoot>
              </table></div>
            </>
          )}
        </Panel>
      )}
    </>
  )
}
