import { useCallback, useEffect, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { gerarExcel, gerarPdf, lerMesesDoFicheiro, lerOrdenados, nomeMes } from '../lib/ordenados'
import { dataHora, deBase64, descarregar, paraBase64, XLSX_TYPE } from '../lib/ficheiros'
import { supabase } from '../supabase'

const HISTORICO = 'ordenados_envios'

const resumoDias = l => (l.length ? `${l.join(', ')}` : '')

export default function Ordenados() {
  const toast = useToast()
  const [horario, setHorario] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [meses, setMeses] = useState([])
  const [mes, setMes] = useState('')
  const [busy, setBusy] = useState(false)
  const [dados, setDados] = useState(null)
  const [guardado, setGuardado] = useState(null)

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

  // Qualquer mudança (outro mês, outra nota) dá um ficheiro novo no histórico.
  useEffect(() => { setGuardado(null) }, [dados])

  const setNota = (i, nota) => setDados(d => ({ ...d, linhas: d.linhas.map((l, k) => (k === i ? { ...l, nota } : l)) }))
  const base = dados ? `Ordenados_contabilidade_${nomeMes(dados.ano, dados.mes).replace(' ', '_')}` : ''

  async function baixar(tipo) {
    setBusy(true)
    try {
      const [excel, pdf] = await Promise.all([gerarExcel(dados), gerarPdf(dados)])
      if (!guardado) {
        const { data, error } = await supabase.from(HISTORICO).insert({
          mes: `${dados.ano}-${String(dados.mes).padStart(2, '0')}`,
          nome_ficheiro: base,
          linhas: dados.linhas.map(l => ({ codigo: l.codigo, nome: l.nome, feriados: l.feriados.length, noites: l.noites, ferias: l.ferias.length, nota: l.nota })),
          excel_base64: paraBase64(excel),
          pdf_base64: paraBase64(pdf),
        }).select('id').single()
        if (error) toast(`O ficheiro foi gerado mas não ficou no histórico: ${error.message}`, 'bad')
        else { setGuardado(data.id); window.dispatchEvent(new Event('ordenados-historico')) }
      }
      if (tipo === 'pdf') descarregar(pdf, `${base}.pdf`, 'application/pdf')
      else descarregar(excel, `${base}.xlsx`, XLSX_TYPE)
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
          {guardado && <div className="notice ok">Guardado no histórico.</div>}
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
      <Historico />
    </>
  )
}

function Historico() {
  const toast = useToast()
  const [envios, setEnvios] = useState(null)
  const [falta, setFalta] = useState(false)
  const [apagar, setApagar] = useState(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from(HISTORICO).select('id, mes, nome_ficheiro, linhas, created_at').order('created_at', { ascending: false }).limit(100)
    if (error) { setFalta(true); setEnvios([]); return }
    setFalta(false)
    setEnvios(data)
  }, [])

  useEffect(() => {
    carregar()
    window.addEventListener('ordenados-historico', carregar)
    return () => window.removeEventListener('ordenados-historico', carregar)
  }, [carregar])

  async function baixar(envio, tipo) {
    const coluna = tipo === 'pdf' ? 'pdf_base64' : 'excel_base64'
    const { data, error } = await supabase.from(HISTORICO).select(coluna).eq('id', envio.id).single()
    if (error) return toast(error.message, 'bad')
    if (!data[coluna]) return toast('Este envio não tem esse ficheiro guardado.', 'bad')
    if (tipo === 'pdf') descarregar(deBase64(data[coluna]), `${envio.nome_ficheiro}.pdf`, 'application/pdf')
    else descarregar(deBase64(data[coluna]), `${envio.nome_ficheiro}.xlsx`, XLSX_TYPE)
  }

  async function remover(envio) {
    const { error } = await supabase.from(HISTORICO).delete().eq('id', envio.id)
    if (error) return toast(error.message, 'bad')
    setApagar(null)
    carregar()
  }

  return (
    <Panel title="Histórico" hint="Cada ficheiro descarregado para a contabilidade fica aqui guardado, em Excel e em PDF.">
      {falta ? <div className="notice warn">Para guardar o histórico, executa uma vez o ficheiro supabase/10_ordenados_envios.sql no Supabase.</div> : (
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Data</th><th>Mês</th><th>Funcionários</th><th>Notas</th><th /></tr></thead>
          <tbody>{envios === null ? <Empty colSpan={5}>A carregar…</Empty> : envios.length ? envios.map(e => (
            <tr key={e.id}>
              <td>{dataHora(e.created_at)}</td>
              <td>{nomeMes(Number(e.mes.slice(0, 4)), Number(e.mes.slice(5, 7)))}</td>
              <td>{e.linhas.length}</td>
              <td className="muted small">{e.linhas.filter(l => l.nota).map(l => `${l.nome}: ${l.nota}`).join(' · ')}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="secondary small" onClick={() => baixar(e, 'xlsx')}>Excel</button>{' '}
                <button className="secondary small" onClick={() => baixar(e, 'pdf')}>PDF</button>{' '}
                {apagar === e.id
                  ? <><button className="danger small" onClick={() => remover(e)}>Confirmar</button>{' '}<button className="link-btn" onClick={() => setApagar(null)}>Cancelar</button></>
                  : <button className="link-btn" onClick={() => setApagar(e.id)}>Apagar</button>}
              </td>
            </tr>
          )) : <Empty colSpan={5}>Ainda não descarregaste nenhum ficheiro.</Empty>}</tbody>
        </table></div>
      )}
    </Panel>
  )
}
