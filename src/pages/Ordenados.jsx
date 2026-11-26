import { useCallback, useEffect, useRef, useState } from 'react'
import { Empty, Modal, Panel, useToast } from '../components/ui'
import { corrigir, gerarExcel, gerarPdf, juntarAjudasCusto, lerFicheiroGuardado, lerMesesDoFicheiro, lerOrdenados, nomeMes, qtd, qtdHorario } from '../lib/ordenados'
import { calcularMapa, lerGuardado, mesmaPessoa } from '../lib/mapaKms'
import { useData } from '../data/DataProvider'
import { dataHora, deBase64, descarregar, paraBase64, XLSX_TYPE } from '../lib/ficheiros'
import { supabase } from '../supabase'
import { ePdf } from '../lib/horarioPdf'
import { lerHorarioPdf } from '../data/horarioPdf'

const HISTORICO = 'ordenados_envios'

const resumoDias = l => (Array.isArray(l) && l.length ? `${l.join(', ')}` : '')

// Número que vem do horário mas que se pode corrigir à mão (fica marcado e mostra o valor original).
function Corrigivel({ linha, campo, onChange, rotulo }) {
  const doHorario = qtdHorario(linha, campo)
  const mudou = linha.corrigido?.[campo] !== undefined
  const dias = resumoDias(linha[campo])
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <input type="number" min="0" step="1" inputMode="numeric" className="cell" value={qtd(linha, campo) || ''} placeholder="0"
        onChange={e => onChange(e.target.value)} aria-label={`${rotulo} de ${linha.nome}`}
        title={mudou ? `Corrigido à mão. No horário: ${doHorario}${dias ? ` (dia ${dias})` : ''}` : dias ? `Dias: ${dias}` : undefined}
        style={{ width: 64, minWidth: 64, textAlign: 'right', ...(mudou ? { background: '#fff6d6', borderColor: '#f0d995', fontWeight: 700 } : {}) }} />
      {mudou && <button type="button" className="link-btn small" title={`Voltar ao valor do horário (${doHorario})`} onClick={() => onChange('')}>↺</button>}
    </span>
  )
}

export default function Ordenados() {
  const toast = useToast()
  const [horario, setHorario] = useState(null)
  const [ordenados, setOrdenados] = useState(null)
  const [meses, setMeses] = useState([])
  const [mes, setMes] = useState('')
  const [busy, setBusy] = useState(false)
  const [dados, setDados] = useState(null)
  const [guardado, setGuardado] = useState(null)
  // Horário em PDF: cada mês é lido uma vez pela leitura automática e fica guardado aqui.
  const grelhas = useRef({})

  async function escolherHorario(file) {
    setHorario(null); setDados(null); setMeses([]); setMes('')
    grelhas.current = {}
    const hoje = new Date()
    if (ePdf(file)) {
      setBusy(true)
      const r = await lerHorarioPdf(file, hoje.getFullYear(), hoje.getMonth() + 1)
      setBusy(false)
      if (r.error) return toast(`Não consegui ler o horário: ${r.error}`, 'bad')
      grelhas.current[`${r.ano}-${r.mes}`] = r.grelha
      setHorario(file); setMeses(r.meses); setMes(`${r.ano}-${r.mes}`)
      return
    }
    setHorario(file)
    try {
      const lista = await lerMesesDoFicheiro(file)
      setMeses(lista)
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
    const fonte = !ePdf(horario) ? Promise.resolve(horario)
      : grelhas.current[mes] ? Promise.resolve({ grelha: grelhas.current[mes] })
        : lerHorarioPdf(horario, ano, m).then(r => {
          if (r.error) throw new Error(`Não consegui ler o horário: ${r.error}`)
          if (r.ano !== ano || r.mes !== m) throw new Error(`O PDF do horário não tem ${nomeMes(ano, m)}.`)
          grelhas.current[mes] = r.grelha
          return { grelha: r.grelha }
        })
    fonte.then(h => lerOrdenados(h, ordenados, ano, m))
      .then(d => { if (ativo) setDados(d) })
      .catch(e => { if (ativo) { setDados(null); toast(e.message, 'bad') } })
      .finally(() => { if (ativo) setBusy(false) })
    return () => { ativo = false }
  }, [horario, ordenados, mes, toast])

  // Ajudas de custo da Patrícia e do Joel = total a receber do mapa de kms do mesmo mês.
  const { invoices } = useData()
  const anoMes = dados ? `${dados.ano}-${dados.mes}` : ''
  useEffect(() => {
    if (!anoMes) return
    const [a, mm] = anoMes.split('-').map(Number)
    const { mapa } = calcularMapa({ invoices, ano: a, mes: mm, guardado: lerGuardado() })
    setDados(d => (d ? { ...d, linhas: juntarAjudasCusto(d.linhas, mapa.recibos, mesmaPessoa) } : d))
  }, [anoMes, invoices])
  const setAjuda = (i, texto) => setDados(d => ({ ...d, linhas: d.linhas.map((l, k) => {
    if (k !== i) return l
    if (String(texto).trim() === '') return { ...l, ajudCusto: l.ajudCustoDoMapa ?? null, ajudCustoMao: false }
    return { ...l, ajudCusto: Math.max(0, Number(String(texto).replace(',', '.')) || 0), ajudCustoMao: true }
  }) }))

  // Qualquer mudança (outro mês, outra nota) dá um ficheiro novo no histórico.
  useEffect(() => { setGuardado(null) }, [dados])

  const setNota = (i, nota) => setDados(d => ({ ...d, linhas: d.linhas.map((l, k) => (k === i ? { ...l, nota } : l)) }))
  const setNumero = (i, campo, texto) => setDados(d => ({ ...d, linhas: d.linhas.map((l, k) => (k === i ? corrigir(l, campo, texto) : l)) }))
  const base = dados ? `Ordenados_contabilidade_${nomeMes(dados.ano, dados.mes).replace(' ', '_')}` : ''

  async function baixar(tipo) {
    setBusy(true)
    try {
      const [excel, pdf] = await Promise.all([gerarExcel(dados), gerarPdf(dados)])
      if (!guardado) {
        const { data, error } = await supabase.from(HISTORICO).insert({
          mes: `${dados.ano}-${String(dados.mes).padStart(2, '0')}`,
          nome_ficheiro: base,
          linhas: dados.linhas.map(l => ({ codigo: l.codigo, nome: l.nome, feriados: qtd(l, 'feriados'), noites: qtd(l, 'noites'), ferias: qtd(l, 'ferias'), faltas: qtd(l, 'faltas'), ...(l.ajudCusto ? { ajudCusto: l.ajudCusto } : {}), nota: l.nota, ...(l.corrigido && Object.keys(l.corrigido).length ? { corrigido: l.corrigido } : {}) })),
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
      <Panel title="Ordenados para a contabilidade" hint="Envia o horário dos funcionários (Excel ou PDF) e o Excel dos ordenados. Contamos os feriados trabalhados, as noites (23h às 7h) e os dias de férias (azul). As ajudas de custo da Patrícia e do Joel vêm do mapa de kms do mês. Escreve as notas que quiseres e descarrega em Excel ou PDF.">
        <div className="actions">
          <label className="file-button"><input type="file" accept=".xlsx,.pdf,application/pdf" disabled={busy} onChange={e => { if (e.target.files[0]) escolherHorario(e.target.files[0]); e.target.value = '' }} />{horario ? `Horário: ${horario.name}` : '1. Escolher o horário (Funcionários)'}</label>
          <label className="file-button"><input type="file" accept=".xlsx" onChange={e => { if (e.target.files[0]) { setOrdenados(e.target.files[0]); setDados(null) } }} />{ordenados ? `Ordenados: ${ordenados.name}` : '2. Escolher o Excel dos ordenados'}</label>
          {meses.length > 0 && (
            <select value={mes} onChange={e => { setMes(e.target.value); setDados(null) }} aria-label="Mês">
              {meses.map(x => <option key={x.folha} value={`${x.ano}-${x.mes}`}>{nomeMes(x.ano, x.mes)}</option>)}
            </select>
          )}
          {busy && !dados && <span className="muted">{horario && !ePdf(horario) ? 'A ler…' : 'A ler o horário… (um PDF pode demorar até um minuto)'}</span>}
        </div>
      </Panel>
      {dados && (
        <Panel title={`Ordenados de ${nomeMes(dados.ano, dados.mes)}`} hint={`Folha “${dados.folhaHorario}” do horário. Cada noite conta no dia em que começa. Podes corrigir os feriados, noites, férias e faltas: o número fica a amarelo e ↺ volta ao do horário. As faltas justificadas (vermelho) só aparecem aqui; se quiseres que vão para a contabilidade, escreve-as nas notas.`}
          actions={<>
            <button className="primary" disabled={busy} onClick={() => baixar('xlsx')}>Descarregar Excel</button>
            <button className="secondary" disabled={busy} onClick={() => baixar('pdf')}>Descarregar PDF</button>
          </>}>
          {dados.semPar.length > 0 && (
            <div className="notice warn">
              Estão no horário mas não na folha da contabilidade, por isso ficam de fora: {dados.semPar.map(f => f.nome).join(', ')}.
            </div>
          )}
          {horario && ePdf(horario) && <div className="notice">Horário lido automaticamente do PDF: confere os números antes de enviar à contabilidade.</div>}
          {guardado && <div className="notice ok">Guardado no histórico.</div>}
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Código</th><th>Nome</th><th className="money">Feriados</th><th className="money">Noites</th><th className="money">Férias</th><th>Faltas justificadas</th><th className="money" title="Kms do mapa de kms (Patrícia e Joel)">Ajud. custo (kms)</th><th>Notas</th></tr></thead>
            <tbody>{dados.linhas.length ? dados.linhas.map((l, i) => (
              <tr key={`${l.codigo}-${l.nome}`} className={l.noHorario ? '' : 'row-muted'}>
                <td>{l.codigo ?? ''}</td>
                <td>{l.nome}{!l.noHorario && <span className="muted small"> · não está no horário</span>}</td>
                <td className="money"><Corrigivel linha={l} campo="feriados" rotulo="Feriados" onChange={v => setNumero(i, 'feriados', v)} /></td>
                <td className="money"><Corrigivel linha={l} campo="noites" rotulo="Noites" onChange={v => setNumero(i, 'noites', v)} /></td>
                <td className="money"><Corrigivel linha={l} campo="ferias" rotulo="Férias" onChange={v => setNumero(i, 'ferias', v)} /></td>
                <td><Corrigivel linha={l} campo="faltas" rotulo="Faltas justificadas" onChange={v => setNumero(i, 'faltas', v)} />{l.faltas.length > 0 && l.corrigido?.faltas === undefined && <span className="muted small"> dia {resumoDias(l.faltas)}</span>}</td>
                <td className="money">
                  {(l.ajudCustoDoMapa !== undefined || l.ajudCustoMao) ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="number" min="0" step="0.01" className="cell" value={l.ajudCusto ?? ''} placeholder="0" onChange={e => setAjuda(i, e.target.value)} aria-label={`Ajudas de custo de ${l.nome}`}
                        title={l.ajudCustoMao ? `Escrito à mão. No mapa de kms: ${l.ajudCustoDoMapa ?? 0} €` : 'Do mapa de kms deste mês'}
                        style={{ width: 90, textAlign: 'right', ...(l.ajudCustoMao ? { background: '#fff6d6', borderColor: '#f0d995', fontWeight: 700 } : {}) }} />
                      {l.ajudCustoMao && <button type="button" className="link-btn small" title="Voltar ao valor do mapa de kms" onClick={() => setAjuda(i, '')}>↺</button>}
                    </span>
                  ) : ''}
                </td>
                <td><input value={l.nota} onChange={e => setNota(i, e.target.value)} placeholder="Sem notas" aria-label={`Notas de ${l.nome}`} style={{ width: '100%', minWidth: 220 }} /></td>
              </tr>
            )) : <Empty colSpan={8}>A folha da contabilidade não tem funcionários.</Empty>}</tbody>
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
  const [vendo, setVendo] = useState(null)

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

  async function ver(envio) {
    setVendo({ envio, ficheiro: null })
    const { data, error } = await supabase.from(HISTORICO).select('excel_base64').eq('id', envio.id).single()
    if (error) { setVendo(null); return toast(error.message, 'bad') }
    try {
      const ficheiro = data.excel_base64 ? await lerFicheiroGuardado(deBase64(data.excel_base64)) : false
      setVendo(v => (v?.envio.id === envio.id ? { envio, ficheiro } : v))
    } catch (e) { setVendo(null); toast(`Não consegui abrir este envio: ${e.message}`, 'bad') }
  }

  async function remover(envio) {
    const { error } = await supabase.from(HISTORICO).delete().eq('id', envio.id)
    if (error) return toast(error.message, 'bad')
    setApagar(null)
    carregar()
  }

  return (
    <Panel title="Histórico" hint="Cada ficheiro descarregado para a contabilidade fica aqui guardado, em Excel e em PDF. Carrega em Ver para o abrir aqui e conferir antes de descarregar.">
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
                <button className="primary small" onClick={() => ver(e)}>Ver</button>{' '}
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
      {vendo && <VerEnvio {...vendo} onClose={() => setVendo(null)} onBaixar={tipo => baixar(vendo.envio, tipo)} />}
    </Panel>
  )
}

// Campo corrigível de cada coluna do ficheiro (para pintar a amarelo o que foi corrigido à mão).
const CORRIGIVEIS = { feriado: 'feriados', noites: 'noites', ferias: 'ferias' }
const chave = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '')

function VerEnvio({ envio, ficheiro, onClose, onBaixar }) {
  const mes = nomeMes(Number(envio.mes.slice(0, 4)), Number(envio.mes.slice(5, 7)))
  const corrigidos = envio.linhas.some(l => l.corrigido && Object.keys(l.corrigido).length)
  return (
    <Modal title={`Ordenados de ${mes}`} onClose={onClose} wide>
      <p className="muted small" style={{ marginTop: 0 }}>Descarregado a {dataHora(envio.created_at)}. É isto que está no ficheiro: confere antes de enviar à contabilidade.</p>
      {ficheiro === null ? <div className="emptybox">A abrir…</div> : ficheiro === false ? (
        <>
          <div className="notice warn">Este envio não tem o Excel guardado. Mostro o resumo que ficou no histórico.</div>
          <div className="tablewrap"><table className="mini-table">
            <thead><tr><th>Código</th><th>Nome</th><th className="money">Feriados</th><th className="money">Noites</th><th className="money">Férias</th><th>Notas</th></tr></thead>
            <tbody>{envio.linhas.map((l, k) => (
              <tr key={k}><td>{l.codigo ?? ''}</td><td>{l.nome}</td><td className="money">{l.feriados || ''}</td><td className="money">{l.noites || ''}</td><td className="money">{l.ferias || ''}</td><td>{l.nota}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      ) : (
        <>
          {ficheiro.titulo && <div style={{ fontWeight: 700 }}>{ficheiro.titulo}</div>}
          {corrigidos && <div className="notice">Os números a amarelo foram corrigidos à mão (diferentes do horário).</div>}
          <div className="tablewrap"><table className="mini-table">
            <thead>
              <tr>{ficheiro.cima.map((c, i) => <th key={i} className="muted small" style={{ textAlign: 'center' }}>{c}</th>)}</tr>
              <tr>{ficheiro.cabecalho.map((c, i) => <th key={i} style={{ textAlign: i === 1 || chave(c) === 'notas' ? 'left' : 'center' }}>{c}</th>)}</tr>
            </thead>
            <tbody>{ficheiro.linhas.map((l, k) => (
              <tr key={k}>{l.map((v, i) => {
                const campo = CORRIGIVEIS[chave(ficheiro.cabecalho[i])]
                const mudou = campo && envio.linhas[k]?.corrigido?.[campo] !== undefined
                const texto = i === 1 || chave(ficheiro.cabecalho[i]) === 'notas'
                return <td key={i} style={{ textAlign: texto ? 'left' : 'center', whiteSpace: texto && i !== 1 ? 'normal' : 'nowrap', ...(texto && i !== 1 ? { minWidth: 240 } : {}), ...(mudou ? { background: '#fff6d6', fontWeight: 700 } : {}) }}>{v}</td>
              })}</tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      <div className="actions" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="primary" onClick={() => onBaixar('xlsx')}>Descarregar Excel</button>
        <button className="secondary" onClick={() => onBaixar('pdf')}>Descarregar PDF</button>
        <button className="link-btn" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  )
}
