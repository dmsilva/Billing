import { useMemo, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { useData } from '../data/DataProvider'
import { descarregar, XLSX_TYPE } from '../lib/ficheiros'
import { nomeMes } from '../lib/ordenados'
import { lerDatasMakro } from '../data/makroLeitura'
import { AssinaturaEditor } from '../components/Assinatura'
import { calcularMapa, CHAVE_GUARDADO, CONFIG_PADRAO, gerarExcel, gerarPdf, lerGuardado, nomeFicheiro, rotuloDia, semanaDe, textoPeriodo } from '../lib/mapaKms'

const guardar = v => { try { localStorage.setItem(CHAVE_GUARDADO, JSON.stringify(v)) } catch { /* sem armazenamento local */ } }
const euro = v => `${Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function mesesParaEscolher() {
  const hoje = new Date()
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 1)
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
  })
}

export default function MapaKms() {
  const toast = useToast()
  const { invoices } = useData()
  const hoje = new Date()
  const [guardado, setGuardado] = useState(lerGuardado)
  // A partir do dia 27 já se está no período do mês seguinte.
  const [mes, setMes] = useState(() => {
    const di = Number(guardado.config?.diaInicio ?? CONFIG_PADRAO.diaInicio)
    const d = di > 1 && hoje.getDate() >= di ? new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1) : hoje
    return `${d.getFullYear()}-${d.getMonth() + 1}`
  })
  const [ano, m] = mes.split('-').map(Number)
  const chaveMes = `${ano}-${String(m).padStart(2, '0')}`
  const { cfg, doMes, periodo, automaticas, idas, mapa } = useMemo(() => calcularMapa({ invoices, ano, mes: m, guardado }), [invoices, ano, m, guardado])
  const variante = doMes.variante || 0
  const [verDefs, setVerDefs] = useState(false)
  const [novaData, setNovaData] = useState('')
  const [novaLoja, setNovaLoja] = useState('makro')
  const [busy, setBusy] = useState(false)

  const [lendo, setLendo] = useState(false)
  async function lerPrint(files) {
    setLendo(true)
    const r = await lerDatasMakro(files)
    setLendo(false)
    if (r.error) return toast(`Não consegui ler: ${r.error}`, 'bad')
    if (!r.datas.length) return toast('Não encontrei datas nesse ficheiro.', 'bad')
    const novo = { ...guardado, makroDatas: [...new Set([...(guardado.makroDatas || []), ...r.datas])].sort() }
    setGuardado(novo); guardar(novo)
    // Mês do mapa onde cai a data mais recente (com o período 27–26, o dia 27 já é do mês seguinte).
    const ultima = r.datas[r.datas.length - 1]
    let a = Number(ultima.slice(0, 4)), mm = Number(ultima.slice(5, 7))
    if (cfg.diaInicio > 1 && Number(ultima.slice(8, 10)) >= cfg.diaInicio) { mm += 1; if (mm > 12) { mm = 1; a += 1 } }
    setMes(`${a}-${mm}`)
    toast(`Li ${r.datas.length} datas da Makro: ${r.datas.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')}.`)
  }
  const listaIdas = Object.entries(idas).flatMap(([d, ks]) => ks.map(k => ({ data: d, loja: k }))).sort((a, b) => a.data.localeCompare(b.data))
  // Formato antigo: dias do mês (números) em vez de datas.
  const aData = d => (/^\d{1,2}$/.test(String(d)) ? `${chaveMes}-${String(d).padStart(2, '0')}` : String(d))
  const nomeLoja = k => cfg.lojas.find(l => l.chave === k)?.local || k

  const mudarMes = alt => {
    const novo = { ...guardado, meses: { ...(guardado.meses || {}), [chaveMes]: { ...doMes, ...alt } } }
    setGuardado(novo); guardar(novo)
  }
  const mudarConfig = cfgNova => { const novo = { ...guardado, config: cfgNova }; setGuardado(novo); guardar(novo) }
  const setDestino = (k, campo, v) => mudarConfig({ ...cfg, destinos: { ...cfg.destinos, [k]: { ...cfg.destinos[k], [campo]: v } } })
  const setPessoa = (i, campo, v) => mudarConfig({ ...cfg, pessoas: cfg.pessoas.map((p, k) => (k === i ? { ...p, [campo]: v } : p)) })

  const trocar = data => {
    const t = new Set((doMes.trocas || []).map(aData))
    t.has(data) ? t.delete(data) : t.add(data)
    mudarMes({ trocas: [...t] })
  }
  const baralhar = () => mudarMes({ variante: variante + 1, trocas: [] })
  const extrasAtuais = () => [...(doMes.idasExtra || []).map(x => ({ data: aData(x.data ?? x.dia), loja: x.loja })), ...(doMes.makroExtra || []).map(d => ({ data: aData(d), loja: 'makro' }))]
  const tirarAtuais = () => [...(doMes.idasTirar || []), ...(doMes.makroTirar || []).map(d => `${d}:makro`)].map(t => { const [d, k] = t.split(':'); return `${aData(d)}:${k}` })
  function juntarIda() {
    if (novaData < periodo.inicio || novaData > periodo.fim) return toast(`Escolhe um dia entre ${textoPeriodo(periodo)}.`, 'bad')
    const k = `${novaData}:${novaLoja}`
    mudarMes({ idasExtra: [...extrasAtuais().filter(x => `${x.data}:${x.loja}` !== k), { data: novaData, loja: novaLoja }], makroExtra: [], idasTirar: tirarAtuais().filter(x => x !== k), makroTirar: [] })
    setNovaData('')
  }
  const tirarIda = (data, loja) => {
    const k = `${data}:${loja}`
    mudarMes({
      idasExtra: extrasAtuais().filter(x => `${x.data}:${x.loja}` !== k),
      makroExtra: [],
      idasTirar: (automaticas[data] || []).includes(loja) ? [...new Set([...tirarAtuais(), k])] : tirarAtuais(),
      makroTirar: [],
    })
  }

  async function baixar(tipo, pessoa) {
    setBusy(true)
    try {
      if (tipo === 'pdf') descarregar(await gerarPdf(mapa, pessoa), `${nomeFicheiro(mapa, pessoa)}.pdf`, 'application/pdf')
      else descarregar(await gerarExcel(mapa, pessoa), `${nomeFicheiro(mapa, pessoa)}.xlsx`, XLSX_TYPE)
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  return (
    <>
      <Panel title="Mapa de kms" hint="Compensação por deslocação em viatura própria. O mapa do mês é gerado sozinho: segunda a sábado ao Chalet do Lago, dois dias por semana a Ponte de Sor, e as idas às lojas (Makro, IKEA, Lidl, Leroy Merlin…) quando há fatura. Cada dia é só de uma pessoa. Cada mês sai diferente. O mapa de um mês vai do dia 27 do mês anterior ao dia 26."
        actions={<>
          {mapa.recibos.map((r, i) => (
            <button key={i} className="primary" disabled={busy} onClick={() => baixar('pdf', i)}>PDF {r.nome.split(' ')[0]}</button>
          ))}
          <button className="secondary" disabled={busy} onClick={() => baixar('xlsx')}>Excel (os dois)</button>
        </>}>
        <div className="actions">
          <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mês">
            {mesesParaEscolher().map(x => <option key={`${x.ano}-${x.mes}`} value={`${x.ano}-${x.mes}`}>{nomeMes(x.ano, x.mes)}</option>)}
          </select>
          <span className="muted">de {rotuloDia(periodo.inicio)} a</span>
          <input type="date" value={periodo.fim} min={periodo.inicio} aria-label="Último dia deste mapa" title="Último dia deste mapa (o do mês seguinte começa no dia a seguir)"
            onChange={e => { if (e.target.value) mudarConfig({ ...cfg, fimPeriodos: { ...cfg.fimPeriodos, [chaveMes]: e.target.value } }) }} />
          <button className="secondary" onClick={baralhar} title="Sorteia outra vez os dias de cada um e de Ponte de Sor">Baralhar outra vez</button>
          <button className="link-btn" onClick={() => setVerDefs(v => !v)}>{verDefs ? 'Esconder definições' : 'Definições (km, preço, viaturas)'}</button>
        </div>
        <div className="notice">
          <strong>Idas às lojas ({textoPeriodo(periodo)}):</strong>{' '}
          {listaIdas.length ? listaIdas.map(x => (
            <span key={`${x.data}:${x.loja}`} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
              {semanaDe(x.data)} {rotuloDia(x.data)} {nomeLoja(x.loja)}{!(automaticas[x.data] || []).includes(x.loja) ? ' (à mão)' : ''}{' '}
              <button className="link-btn small" title="Tirar esta ida" onClick={() => tirarIda(x.data, x.loja)}>×</button>
            </span>
          )) : <span className="muted">nenhuma fatura das lojas registada neste mês. </span>}
          <span style={{ whiteSpace: 'nowrap' }}>
            <input type="date" value={novaData} min={periodo.inicio} max={periodo.fim} onChange={e => setNovaData(e.target.value)} aria-label="Dia a juntar" style={{ marginLeft: 6 }} />
            <select value={novaLoja} onChange={e => setNovaLoja(e.target.value)} aria-label="Loja">
              {cfg.lojas.map(l => <option key={l.chave} value={l.chave}>{l.local}</option>)}
            </select>
            <button className="secondary small" onClick={juntarIda} disabled={!novaData}>Juntar ida</button>
          </span>
          <div style={{ marginTop: 6 }}>
            <label className="file-button"><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={lendo} onChange={e => { if (e.target.files.length) lerPrint(e.target.files); e.target.value = '' }} />{lendo ? 'A ler as datas…' : 'Enviar print da lista de faturas da Makro'}</label>
          </div>
          <div className="muted small">Envia o print da app da Makro (lista de faturas) e as datas entram sozinhas. Também contam sozinhas as faturas na app de {cfg.lojas.map(l => l.local).join(', ')} (lojas e kms em Definições). Podes juntar ou tirar uma ida à mão.</div>
        </div>
        {(() => {
          const dif = Math.abs(mapa.recibos[0].total - mapa.recibos[1].total)
          const max = Number(cfg.diferencaMaxima) || 0
          return <div className={`notice ${dif > max ? 'warn' : 'ok'}`}>Diferença entre os dois: <strong>{euro(dif)}</strong>{dif > max ? ` (mais de ${euro(max)}: carrega em "Baralhar outra vez" ou desfaz as trocas à mão)` : ` (máximo ${euro(max)})`}</div>
        })()}
        {verDefs && <Definicoes cfg={cfg} setDestino={setDestino} setPessoa={setPessoa} mudarConfig={mudarConfig} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 12 }}>
          {mapa.recibos.map((rec, i) => (
            <div key={i}>
              <h3 style={{ margin: '4px 0' }}>{rec.nome} <button className="link-btn small" disabled={busy} onClick={() => baixar('pdf', i)}>PDF</button> <button className="link-btn small" disabled={busy} onClick={() => baixar('xlsx', i)}>Excel</button> <span className="muted small">· {rec.viatura} · {rec.dias} dias{rec.assinatura?.src ? ' · assinado' : ' · sem assinatura (põe em Definições)'}</span></h3>
              <div className="tablewrap"><table className="mini-table">
                <thead><tr><th>Dia</th><th>Local de destino</th><th>Tempo</th><th>Objetivo</th><th className="money">Kms</th><th /></tr></thead>
                <tbody>{rec.linhas.length ? rec.linhas.map((l, k) => (
                  <tr key={k}>
                    <td><strong>{l.rotulo}</strong> <span className="muted small">{semanaDe(l.data)}</span></td>
                    <td>{l.local}<div className="muted small">{l.cidade}</div></td>
                    <td>{l.tempo}</td>
                    <td>{l.objetivo}</td>
                    <td className="money">{l.kms}</td>
                    <td>{(k === 0 || rec.linhas[k - 1].data !== l.data) && <button className="link-btn small" title={`Passar o dia ${l.rotulo} para ${mapa.recibos[1 - i].nome}`} onClick={() => trocar(l.data)}>⇄</button>}</td>
                  </tr>
                )) : <Empty colSpan={6}>Sem dias.</Empty>}</tbody>
                <tfoot>
                  <tr><td colSpan={4} className="money">Total de kms</td><td className="money"><strong>{rec.totalKms.toLocaleString('pt-PT')}</strong></td><td /></tr>
                  <tr><td colSpan={4} className="money">Preço por km</td><td className="money">{euro(cfg.precoKm)}</td><td /></tr>
                  <tr><td colSpan={4} className="money">Total a receber</td><td className="money"><strong>{euro(rec.total)}</strong></td><td /></tr>
                </tfoot>
              </table></div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

function Definicoes({ cfg, setDestino, setPessoa, mudarConfig }) {
  const toast = useToast()
  const nomes = { chalet: 'Chalet do Lago', ponteSor: 'Ponte de Sor' }
  return (
    <div className="notice" style={{ display: 'grid', gap: 8 }}>
      <div className="actions">
        <label>Firma <input value={cfg.firma} onChange={e => mudarConfig({ ...cfg, firma: e.target.value })} style={{ minWidth: 220 }} /></label>
        <label>NIF <input value={cfg.nif} onChange={e => mudarConfig({ ...cfg, nif: e.target.value })} style={{ width: 110 }} /></label>
        <label>Assinado em <input value={cfg.localAssinatura} onChange={e => mudarConfig({ ...cfg, localAssinatura: e.target.value })} style={{ width: 110 }} /></label>
        <label>Diferença máx. (€) <input type="number" step="1" min="0" value={cfg.diferencaMaxima} onChange={e => mudarConfig({ ...cfg, diferencaMaxima: Number(e.target.value) || 0 })} style={{ width: 70 }} /></label>
        <label title="O mapa de um mês começa neste dia do mês anterior (27 = de 27/10 a 26/11). 1 = mês do calendário.">Começa no dia <input type="number" min="1" max="28" value={cfg.diaInicio} onChange={e => mudarConfig({ ...cfg, diaInicio: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} style={{ width: 60 }} /></label>
        <label>€ por km <input type="number" step="0.01" min="0" value={cfg.precoKm} onChange={e => mudarConfig({ ...cfg, precoKm: Number(e.target.value) || 0 })} style={{ width: 80 }} /></label>
        <label><input type="checkbox" checked={cfg.makroLinhaAParte} onChange={e => mudarConfig({ ...cfg, makroLinhaAParte: e.target.checked })} /> No dia das compras também vão ao Chalet do Lago</label>
      </div>
      {cfg.pessoas.map((p, i) => (
        <div className="actions" key={i}>
          <label>Nome <input value={p.nome} onChange={e => setPessoa(i, 'nome', e.target.value)} style={{ minWidth: 220 }} /></label>
          <label>Viatura <input value={p.viatura} onChange={e => setPessoa(i, 'viatura', e.target.value)} style={{ width: 100 }} /></label>
          <AssinaturaEditor valor={p.assinatura} onChange={a => setPessoa(i, 'assinatura', a)} onErro={msg => toast(msg, 'bad')} />
        </div>
      ))}
      {Object.entries(cfg.destinos).map(([k, d]) => (
        <div className="actions" key={k}>
          <strong style={{ minWidth: 110 }}>{nomes[k]}</strong>
          <label>Local <input value={d.local} onChange={e => setDestino(k, 'local', e.target.value)} style={{ minWidth: 170 }} /></label>
          <label>Cidade <input value={d.cidade} onChange={e => setDestino(k, 'cidade', e.target.value)} style={{ width: 110 }} /></label>
          <label>Kms <input type="number" min="0" value={d.kms} onChange={e => setDestino(k, 'kms', Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
          <label>Objetivo <input value={d.objetivo} onChange={e => setDestino(k, 'objetivo', e.target.value)} style={{ width: 100 }} /></label>
        </div>
      ))}
      <strong>Lojas (a ida entra no mapa quando há fatura com esta palavra no fornecedor)</strong>
      {cfg.lojas.map((l, i) => {
        const setLoja = (campo, v) => mudarConfig({ ...cfg, lojas: cfg.lojas.map((x, k) => (k === i ? { ...x, [campo]: v } : x)) })
        return (
          <div className="actions" key={l.chave}>
            <label>Loja <input value={l.local} onChange={e => setLoja('local', e.target.value)} style={{ width: 130 }} /></label>
            <label>Palavra na fatura <input value={l.procura} onChange={e => setLoja('procura', e.target.value)} style={{ width: 100 }} /></label>
            <label>Cidade <input value={l.cidade} onChange={e => setLoja('cidade', e.target.value)} style={{ width: 110 }} /></label>
            <label>Kms (ida e volta) <input type="number" min="0" value={l.kms} onChange={e => setLoja('kms', Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
            <button className="link-btn small" onClick={() => mudarConfig({ ...cfg, lojas: cfg.lojas.filter((_, k) => k !== i) })}>Tirar</button>
          </div>
        )
      })}
      <div><button className="secondary small" onClick={() => mudarConfig({ ...cfg, lojas: [...cfg.lojas, { chave: `loja${Date.now()}`, procura: '', local: 'Nova loja', cidade: 'Lisboa', kms: 10, tempos: ['1 hora'], objetivo: 'Compras' }] })}>+ Juntar loja</button></div>
      <div><button className="link-btn" onClick={() => mudarConfig({ ...CONFIG_PADRAO, pessoas: CONFIG_PADRAO.pessoas.map((p, i) => ({ ...p, assinatura: cfg.pessoas[i]?.assinatura })) })}>Voltar às definições de origem</button></div>
    </div>
  )
}
