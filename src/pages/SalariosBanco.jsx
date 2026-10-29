import { useCallback, useEffect, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { lerOrdenados, MESES, nomeMes } from '../lib/ordenados'
import { aPagar, casarFolhaBanco, conferirRecibos, gerarFolhaBanco, lerRecibos, tsvBanco } from '../lib/recibos'
import { euro, parseMoney, sum } from '../lib/money'
import { supabase } from '../supabase'
import { dataHora, deBase64, descarregar, paraBase64, XLSX_TYPE } from '../lib/ficheiros'

const TSV_TYPE = 'text/tab-separated-values;charset=utf-8'
const HISTORICO = 'salarios_banco_envios'

const nomeDoMes = mes => MESES[mes - 1][0].toUpperCase() + MESES[mes - 1].slice(1)
const textoValor = v => (v == null ? '' : v.toFixed(2).replace('.', ','))
const mesIso = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`

export default function SalariosBanco() {
  const toast = useToast()
  const [pdf, setPdf] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [horario, setHorario] = useState(null)
  const [lidos, setLidos] = useState(null)
  const [casado, setCasado] = useState(null)
  const [pagamentos, setPagamentos] = useState([])
  const [conferencia, setConferencia] = useState(null)
  const [guardado, setGuardado] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pdf) return
    let ativo = true
    lerRecibos(pdf)
      .then(r => { if (ativo) setLidos(r) })
      .catch(e => { if (ativo) { setLidos(null); toast(`Não consegui ler o PDF: ${e.message}`, 'bad') } })
    return () => { ativo = false }
  }, [pdf, toast])

  useEffect(() => {
    if (!lidos?.mes || !ordenados) return
    let ativo = true
    ordenados.arrayBuffer()
      .then(async buffer => ({ buffer, ...(await casarFolhaBanco(buffer, lidos.recibos)) }))
      .then(c => {
        if (!ativo) return
        setCasado(c)
        setPagamentos(c.pagamentos.map(p => ({ ...p, valorTexto: textoValor(p.valor) })))
        setGuardado(null)
      })
      .catch(e => { if (ativo) { setCasado(null); toast(e.message, 'bad') } })
    return () => { ativo = false }
  }, [lidos, ordenados, toast])

  useEffect(() => {
    if (!lidos?.mes || !ordenados || !horario) return
    let ativo = true
    lerOrdenados(horario, ordenados, lidos.ano, lidos.mes)
      .then(d => { if (ativo) setConferencia(conferirRecibos(lidos.recibos, d.linhas)) })
      .catch(e => { if (ativo) { setConferencia(null); toast(e.message, 'bad') } })
    return () => { ativo = false }
  }, [lidos, ordenados, horario, toast])

  function editar(i, alteracao) {
    setPagamentos(ps => ps.map((p, k) => (k === i ? { ...p, ...alteracao } : p)))
    setGuardado(null)
  }

  const mes = lidos?.mes ? nomeDoMes(lidos.mes) : ''
  const base = lidos?.mes ? `Ordenados_Chalet_${mes}_${lidos.ano}` : ''
  const pagar = aPagar(pagamentos)
  const total = sum(pagar.map(p => p.valor))
  const valorInvalido = pagamentos.some(p => p.incluir && p.valorTexto.trim() && p.valor == null)
  // Uma pessoa sem recibo neste PDF não é um erro do contabilista (o PDF pode trazer só alguns recibos).
  const comProblemas = conferencia ? conferencia.linhas.filter(l => l.recibo && l.problemas.length) : []

  async function baixar(tipo) {
    if (!pagar.length) return toast('Não há ninguém marcado para pagar.', 'bad')
    if (valorInvalido) return toast('Há valores que não percebo. Corrige-os antes de descarregar.', 'bad')
    setBusy(true)
    try {
      const tsv = tsvBanco(pagamentos, mes)
      const excel = gerarFolhaBanco(casado.buffer, casado.folha, pagamentos, mes)
      if (!guardado) {
        const { data, error } = await supabase.from(HISTORICO).insert({
          mes: mesIso(lidos.ano, lidos.mes),
          nome_ficheiro: base,
          linhas: pagar.map(p => ({ nome: p.nome, iban: p.iban, bic: p.bic, valor: p.valor })),
          total,
          tsv,
          excel_base64: paraBase64(excel),
        }).select('id').single()
        if (error) toast(`O ficheiro foi gerado mas não ficou no histórico: ${error.message}`, 'bad')
        else { setGuardado(data.id); window.dispatchEvent(new Event('salarios-historico')) }
      }
      if (tipo === 'tsv') descarregar(tsv, `${base}.tsv`, TSV_TYPE)
      else descarregar(excel, `${base}.xlsx`, XLSX_TYPE)
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  return (
    <>
      <Panel title="Salários para o banco" hint="Envia o PDF dos recibos do contabilista e o Excel dos ordenados (com a folha Ordenados_Chalet). Preenchemos o valor a pagar a cada pessoa e o mês. Podes retirar pessoas ou mudar valores antes de descarregar. Se o PDF só tiver alguns recibos, o ficheiro leva só essas pessoas. Se juntares o horário, também conferimos os feriados, as noites e as faltas.">
        <div className="actions">
          <label className="file-button"><input type="file" accept=".pdf" onChange={e => { if (e.target.files[0]) { setPdf(e.target.files[0]); setLidos(null); setCasado(null); setPagamentos([]); setConferencia(null) } }} />{pdf ? `Recibos: ${pdf.name}` : '1. Escolher o PDF dos recibos'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setOrdenados(e.target.files[0]); setCasado(null); setPagamentos([]); setConferencia(null) } }} />{ordenados ? `Ordenados: ${ordenados.name}` : '2. Escolher o Excel dos ordenados'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setHorario(e.target.files[0]); setConferencia(null) } }} />{horario ? `Horário: ${horario.name}` : '3. Horário (opcional, para conferir)'}</label>
        </div>
        {lidos && !lidos.mes && <div className="notice bad">Não encontrei a data dos recibos no PDF.</div>}
      </Panel>
      {lidos?.mes && (
        <Panel title={`Recibos de ${nomeMes(lidos.ano, lidos.mes)}`} hint={`${lidos.recibos.length === 1 ? '1 recibo' : `${lidos.recibos.length} recibos`} no PDF. Desmarca quem não queres pagar agora; podes também escrever outro valor.`}
          actions={casado && <>
            <button className="primary" disabled={busy} onClick={() => baixar('tsv')}>Descarregar ficheiro para o banco (TSV)</button>
            <button className="secondary" disabled={busy} onClick={() => baixar('xlsx')}>Descarregar Excel</button>
          </>}>
          {!ordenados && <div className="notice warn">Falta o Excel dos ordenados para saber o IBAN de cada pessoa.</div>}
          {casado?.semLinha.length > 0 && <div className="notice bad">Têm recibo mas não estão na folha Ordenados_Chalet (não vão ser pagos): {casado.semLinha.join(', ')}.</div>}
          {conferencia && (comProblemas.length
            ? <div className="notice bad">O contabilista não bate certo em {comProblemas.length === 1 ? '1 pessoa' : `${comProblemas.length} pessoas`}: {comProblemas.map(l => l.linha.nome).join(', ')}.</div>
            : <div className="notice ok">Os recibos deste PDF batem certo com o horário: feriados, noites, faltas e vencimentos.</div>)}
          {guardado && <div className="notice ok">Guardado no histórico.</div>}
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Pagar</th><th>Nome</th><th className="money">Valor a pagar</th>{conferencia && <th>Conferência</th>}</tr></thead>
            <tbody>{casado ? (pagamentos.length ? pagamentos.map((p, i) => {
              const problemas = p.recibo ? conferencia?.linhas.find(l => l.recibo === p.recibo)?.problemas || [] : []
              return (
                <tr key={p.linha} className={p.incluir ? '' : 'row-muted'}>
                  <td><input type="checkbox" checked={p.incluir} onChange={e => editar(i, { incluir: e.target.checked })} aria-label={`Pagar a ${p.nome}`} /></td>
                  <td>{p.nome}{!p.recibo && <span className="muted small"> · sem recibo neste PDF</span>}</td>
                  <td className="money"><input className="money-input" inputMode="decimal" value={p.valorTexto} placeholder="0,00" aria-label={`Valor de ${p.nome}`}
                    onChange={e => { const t = e.target.value; const v = parseMoney(t); editar(i, { valorTexto: t, valor: v, incluir: t.trim() ? (p.incluir || v != null) : false }) }} /></td>
                  {conferencia && <td className={problemas.length ? 'bad' : 'ok'}>{p.recibo ? (problemas.length ? problemas.join(' ') : 'Certo') : ''}</td>}
                </tr>
              )
            }) : <Empty colSpan={4}>A folha Ordenados_Chalet não tem ninguém.</Empty>)
              : lidos.recibos.map(r => (
                <tr key={r.codigo}><td /><td>{r.nome}</td><td className="money">{r.pago != null ? euro(r.pago) : ''}</td>{conferencia && <td />}</tr>
              ))}</tbody>
            <tfoot><tr><td /><td>{casado ? `A pagar: ${pagar.length === 1 ? '1 pessoa' : `${pagar.length} pessoas`}` : 'Total'}</td><td className="money">{euro(casado ? total : sum(lidos.recibos.map(r => r.pago ?? 0)))}</td>{conferencia && <td />}</tr></tfoot>
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
    const { data, error } = await supabase.from(HISTORICO).select('id, mes, nome_ficheiro, linhas, total, created_at').order('created_at', { ascending: false }).limit(100)
    if (error) { setFalta(true); setEnvios([]); return }
    setFalta(false)
    setEnvios(data)
  }, [])

  useEffect(() => {
    carregar()
    window.addEventListener('salarios-historico', carregar)
    return () => window.removeEventListener('salarios-historico', carregar)
  }, [carregar])

  async function baixar(envio, tipo) {
    const { data, error } = await supabase.from(HISTORICO).select('tsv, excel_base64').eq('id', envio.id).single()
    if (error) return toast(error.message, 'bad')
    if (tipo === 'tsv') descarregar(data.tsv, `${envio.nome_ficheiro}.tsv`, TSV_TYPE)
    else if (data.excel_base64) descarregar(deBase64(data.excel_base64), `${envio.nome_ficheiro}.xlsx`, XLSX_TYPE)
    else toast('Este envio não tem o Excel guardado.', 'bad')
  }

  async function remover(envio) {
    const { error } = await supabase.from(HISTORICO).delete().eq('id', envio.id)
    if (error) return toast(error.message, 'bad')
    setApagar(null)
    carregar()
  }

  return (
    <Panel title="Histórico" hint="Cada ficheiro descarregado fica aqui guardado, com quem foi pago e quanto.">
      {falta ? <div className="notice warn">Para guardar o histórico, executa uma vez o ficheiro supabase/09_salarios_banco.sql no Supabase.</div> : (
        <div className="tablewrap"><table className="mini-table">
          <thead><tr><th>Data</th><th>Mês</th><th>Pessoas</th><th className="money">Total</th><th /></tr></thead>
          <tbody>{envios === null ? <Empty colSpan={5}>A carregar…</Empty> : envios.length ? envios.map(e => (
            <tr key={e.id}>
              <td>{dataHora(e.created_at)}</td>
              <td>{nomeMes(Number(e.mes.slice(0, 4)), Number(e.mes.slice(5, 7)))}</td>
              <td title={e.linhas.map(l => `${l.nome}: ${euro(l.valor)}`).join('\n')}>{e.linhas.length <= 4 ? e.linhas.map(l => l.nome).join(', ') : `${e.linhas.length} pessoas`}</td>
              <td className="money">{euro(Number(e.total))}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="secondary small" onClick={() => baixar(e, 'tsv')}>TSV</button>{' '}
                <button className="secondary small" onClick={() => baixar(e, 'xlsx')}>Excel</button>{' '}
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
