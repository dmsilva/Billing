import { useEffect, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { lerOrdenados, MESES, nomeMes } from '../lib/ordenados'
import { conferirRecibos, lerRecibos, preencherFolhaBanco } from '../lib/recibos'
import { euro, sum } from '../lib/money'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function descarregar(conteudo, nome, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([conteudo], { type }))
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const nomeDoMes = mes => MESES[mes - 1][0].toUpperCase() + MESES[mes - 1].slice(1)

export default function SalariosBanco() {
  const toast = useToast()
  const [pdf, setPdf] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [horario, setHorario] = useState(null)
  const [lidos, setLidos] = useState(null)
  const [banco, setBanco] = useState(null)
  const [conferencia, setConferencia] = useState(null)

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
      .then(buf => preencherFolhaBanco(buf, lidos.recibos, nomeDoMes(lidos.mes)))
      .then(b => { if (ativo) setBanco(b) })
      .catch(e => { if (ativo) { setBanco(null); toast(e.message, 'bad') } })
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

  const mes = lidos?.mes ? nomeDoMes(lidos.mes) : ''
  const base = lidos?.mes ? `Ordenados_Chalet_${mes}_${lidos.ano}` : ''
  const problemasDe = recibo => conferencia?.linhas.find(l => l.recibo === recibo)?.problemas || []
  const comProblemas = conferencia ? conferencia.linhas.filter(l => l.problemas.length) : []

  return (
    <>
      <Panel title="Salários para o banco" hint="Envia o PDF dos recibos do contabilista e o Excel dos ordenados (com a folha Ordenados_Chalet). Preenchemos o valor a pagar a cada pessoa e o mês, e descarregas o ficheiro para importar no banco. Se juntares o horário, também conferimos os feriados, as noites e as faltas com o que foi enviado à contabilidade.">
        <div className="actions">
          <label className="file-button"><input type="file" accept=".pdf" onChange={e => { if (e.target.files[0]) { setPdf(e.target.files[0]); setLidos(null); setBanco(null); setConferencia(null) } }} />{pdf ? `Recibos: ${pdf.name}` : '1. Escolher o PDF dos recibos'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setOrdenados(e.target.files[0]); setBanco(null); setConferencia(null) } }} />{ordenados ? `Ordenados: ${ordenados.name}` : '2. Escolher o Excel dos ordenados'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setHorario(e.target.files[0]); setConferencia(null) } }} />{horario ? `Horário: ${horario.name}` : '3. Horário (opcional, para conferir)'}</label>
        </div>
        {lidos && !lidos.mes && <div className="notice bad">Não encontrei a data dos recibos no PDF.</div>}
      </Panel>
      {lidos?.mes && (
        <Panel title={`Recibos de ${nomeMes(lidos.ano, lidos.mes)}`}
          actions={banco && <>
            <button className="primary" onClick={() => descarregar(banco.tsv, `${base}.tsv`, 'text/tab-separated-values;charset=utf-8')}>Descarregar ficheiro para o banco (TSV)</button>
            <button className="secondary" onClick={() => descarregar(banco.ficheiro, `${base}.xlsx`, XLSX_TYPE)}>Descarregar Excel</button>
          </>}>
          {!ordenados && <div className="notice warn">Falta o Excel dos ordenados para saber o IBAN de cada pessoa.</div>}
          {banco?.semRecibo.length > 0 && <div className="notice warn">Sem recibo neste PDF, ficam fora do ficheiro do banco: {banco.semRecibo.join(', ')}.</div>}
          {banco?.semLinha.length > 0 && <div className="notice bad">Têm recibo mas não estão na folha Ordenados_Chalet (não vão ser pagos): {banco.semLinha.join(', ')}.</div>}
          {conferencia && (comProblemas.length
            ? <div className="notice bad">O contabilista não bate certo em {comProblemas.length === 1 ? '1 pessoa' : `${comProblemas.length} pessoas`}: {comProblemas.map(l => l.linha.nome).join(', ')}.</div>
            : <div className="notice ok">Está tudo certo: feriados, noites, faltas e vencimentos batem com o horário.</div>)}
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Nome</th><th className="money">Valor a pagar</th>{conferencia && <th>Conferência</th>}</tr></thead>
            <tbody>{banco ? (banco.pagamentos.length ? banco.pagamentos.map(p => {
              const problemas = p.recibo ? problemasDe(p.recibo) : []
              return (
                <tr key={p.linha} className={p.recibo ? '' : 'row-muted'}>
                  <td>{p.nome}{!p.recibo && <span className="muted small"> · sem recibo</span>}</td>
                  <td className="money">{p.valor != null ? euro(p.valor) : ''}</td>
                  {conferencia && <td className={problemas.length ? 'bad' : 'ok'}>{p.recibo ? (problemas.length ? problemas.join(' ') : 'Certo') : ''}</td>}
                </tr>
              )
            }) : <Empty colSpan={3}>A folha Ordenados_Chalet não tem ninguém.</Empty>)
              : lidos.recibos.map(r => (
                <tr key={r.codigo}><td>{r.nome}</td><td className="money">{r.pago != null ? euro(r.pago) : ''}</td>{conferencia && <td />}</tr>
              ))}</tbody>
            <tfoot><tr><td>Total</td><td className="money">{euro(banco ? sum(banco.pagamentos.map(p => p.valor ?? 0)) : sum(lidos.recibos.map(r => r.pago ?? 0)))}</td>{conferencia && <td />}</tr></tfoot>
          </table></div>
        </Panel>
      )}
    </>
  )
}
