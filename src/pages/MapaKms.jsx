import { useMemo, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { useData } from '../data/DataProvider'
import { descarregar, XLSX_TYPE } from '../lib/ficheiros'
import { nomeMes } from '../lib/ordenados'
import { lerDatasMakro } from '../data/makroLeitura'
import { CONFIG_PADRAO, diasDoMes, idasDasFaturas, idasDeDias, juntarIdas, MAKRO_CONHECIDAS, gerarExcel, gerarMapa, gerarPdf, juntarConfig, nomeFicheiro, SEMANA, trocarPessoa } from '../lib/mapaKms'

const CHAVE = 'faturaclaro-mapa-kms'
const lerGuardado = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') } catch { return {} } }
const guardar = v => { try { localStorage.setItem(CHAVE, JSON.stringify(v)) } catch { /* sem armazenamento local */ } }
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
  const [mes, setMes] = useState(`${hoje.getFullYear()}-${hoje.getMonth() + 1}`)
  const [ano, m] = mes.split('-').map(Number)
  const [guardado, setGuardado] = useState(lerGuardado)
  const cfg = useMemo(() => juntarConfig(guardado.config), [guardado.config])
  const chaveMes = `${ano}-${String(m).padStart(2, '0')}`
  const doMes = guardado.meses?.[chaveMes] || {}
  const variante = doMes.variante || 0
  // Dias juntados/tirados à mão (formato antigo: só Makro).
  const extra = [...(doMes.idasExtra || []), ...(doMes.makroExtra || []).map(dia => ({ dia, loja: 'makro' }))]
  const tirar = [...(doMes.idasTirar || []), ...(doMes.makroTirar || []).map(d => `${d}:makro`)]
  const [verDefs, setVerDefs] = useState(false)
  const [novaData, setNovaData] = useState('')
  const [novaLoja, setNovaLoja] = useState('makro')
  const [busy, setBusy] = useState(false)

  const datasLidas = guardado.makroDatas
  const automaticas = useMemo(() => juntarIdas(
    idasDasFaturas(invoices, ano, m, cfg.lojas),
    idasDeDias(diasDoMes(MAKRO_CONHECIDAS, ano, m), 'makro'),
    idasDeDias(diasDoMes(datasLidas, ano, m), 'makro'),
  ), [invoices, ano, m, datasLidas, cfg.lojas])
  const [lendo, setLendo] = useState(false)
  async function lerPrint(files) {
    setLendo(true)
    const r = await lerDatasMakro(files)
    setLendo(false)
    if (r.error) return toast(`Não consegui ler: ${r.error}`, 'bad')
    if (!r.datas.length) return toast('Não encontrei datas nesse ficheiro.', 'bad')
    const novo = { ...guardado, makroDatas: [...new Set([...(guardado.makroDatas || []), ...r.datas])].sort() }
    setGuardado(novo); guardar(novo)
    const primeira = r.datas[r.datas.length - 1]
    setMes(`${Number(primeira.slice(0, 4))}-${Number(primeira.slice(5, 7))}`)
    toast(`Li ${r.datas.length} datas da Makro: ${r.datas.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')}.`)
  }
  const idas = useMemo(() => {
    const r = juntarIdas(automaticas, ...extra.map(x => ({ [x.dia]: [x.loja] })))
    for (const t of tirar) { const [d, k] = t.split(':'); if (r[d]) r[d] = r[d].filter(x => x !== k) }
    return r
  }, [automaticas, extra, tirar])
  const listaIdas = Object.entries(idas).flatMap(([d, ks]) => ks.map(k => ({ dia: Number(d), loja: k }))).sort((a, b) => a.dia - b.dia)
  const nomeLoja = k => cfg.lojas.find(l => l.chave === k)?.local || k
  const base = useMemo(() => gerarMapa({ ano, mes: m, idas, config: cfg, variante }), [ano, m, idas, cfg, variante])
  const mapa = useMemo(() => (doMes.trocas || []).reduce((r, d) => trocarPessoa(r, d), base), [base, doMes.trocas])

  const mudarMes = alt => {
    const novo = { ...guardado, meses: { ...(guardado.meses || {}), [chaveMes]: { ...doMes, ...alt } } }
    setGuardado(novo); guardar(novo)
  }
  const mudarConfig = cfgNova => { const novo = { ...guardado, config: cfgNova }; setGuardado(novo); guardar(novo) }
  const setDestino = (k, campo, v) => mudarConfig({ ...cfg, destinos: { ...cfg.destinos, [k]: { ...cfg.destinos[k], [campo]: v } } })
  const setPessoa = (i, campo, v) => mudarConfig({ ...cfg, pessoas: cfg.pessoas.map((p, k) => (k === i ? { ...p, [campo]: v } : p)) })

  const trocar = dia => {
    const t = new Set(doMes.trocas || [])
    t.has(dia) ? t.delete(dia) : t.add(dia)
    mudarMes({ trocas: [...t] })
  }
  const baralhar = () => mudarMes({ variante: variante + 1, trocas: [] })
  function juntarIda() {
    if (!novaData.startsWith(`${chaveMes}-`)) return toast(`Escolhe um dia de ${nomeMes(ano, m)}.`, 'bad')
    const dia = Number(novaData.slice(8, 10))
    const k = `${dia}:${novaLoja}`
    mudarMes({ idasExtra: [...(doMes.idasExtra || []).filter(x => `${x.dia}:${x.loja}` !== k), { dia, loja: novaLoja }], idasTirar: (doMes.idasTirar || []).filter(x => x !== k), makroTirar: (doMes.makroTirar || []).filter(d => `${d}:makro` !== k) })
    setNovaData('')
  }
  const tirarIda = (dia, loja) => {
    const k = `${dia}:${loja}`
    mudarMes({
      idasExtra: (doMes.idasExtra || []).filter(x => `${x.dia}:${x.loja}` !== k),
      makroExtra: (doMes.makroExtra || []).filter(d => `${d}:makro` !== k),
      idasTirar: (automaticas[dia] || []).includes(loja) ? [...new Set([...(doMes.idasTirar || []), k])] : (doMes.idasTirar || []),
    })
  }

  async function baixar(tipo) {
    setBusy(true)
    try {
      if (tipo === 'pdf') descarregar(await gerarPdf(mapa), `${nomeFicheiro(mapa)}.pdf`, 'application/pdf')
      else descarregar(await gerarExcel(mapa), `${nomeFicheiro(mapa)}.xlsx`, XLSX_TYPE)
    } catch (e) { toast(e.message, 'bad') }
    setBusy(false)
  }

  const semana = d => SEMANA[new Date(Date.UTC(ano, m - 1, d)).getUTCDay()]

  return (
    <>
      <Panel title="Mapa de kms" hint="Compensação por deslocação em viatura própria. O mapa do mês é gerado sozinho: segunda a sábado ao Chalet do Lago, dois dias por semana a Ponte de Sor, e as idas às lojas (Makro, IKEA, Lidl, Leroy Merlin…) quando há fatura. Cada dia é só de uma pessoa. Cada mês sai diferente."
        actions={<>
          <button className="primary" disabled={busy} onClick={() => baixar('xlsx')}>Descarregar Excel</button>
          <button className="secondary" disabled={busy} onClick={() => baixar('pdf')}>Descarregar PDF</button>
        </>}>
        <div className="actions">
          <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mês">
            {mesesParaEscolher().map(x => <option key={`${x.ano}-${x.mes}`} value={`${x.ano}-${x.mes}`}>{nomeMes(x.ano, x.mes)}</option>)}
          </select>
          <button className="secondary" onClick={baralhar} title="Sorteia outra vez os dias de cada um e de Ponte de Sor">Baralhar outra vez</button>
          <button className="link-btn" onClick={() => setVerDefs(v => !v)}>{verDefs ? 'Esconder definições' : 'Definições (km, preço, viaturas)'}</button>
        </div>
        <div className="notice">
          <strong>Idas às lojas em {nomeMes(ano, m)}:</strong>{' '}
          {listaIdas.length ? listaIdas.map(x => (
            <span key={`${x.dia}:${x.loja}`} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
              {semana(x.dia)} {x.dia} {nomeLoja(x.loja)}{!(automaticas[x.dia] || []).includes(x.loja) ? ' (à mão)' : ''}{' '}
              <button className="link-btn small" title="Tirar esta ida" onClick={() => tirarIda(x.dia, x.loja)}>×</button>
            </span>
          )) : <span className="muted">nenhuma fatura das lojas registada neste mês. </span>}
          <span style={{ whiteSpace: 'nowrap' }}>
            <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)} aria-label="Dia a juntar" style={{ marginLeft: 6 }} />
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
              <h3 style={{ margin: '4px 0' }}>{rec.nome} <span className="muted small">· {rec.viatura} · {rec.dias} dias</span></h3>
              <div className="tablewrap"><table className="mini-table">
                <thead><tr><th>Dia</th><th>Local de destino</th><th>Tempo</th><th>Objetivo</th><th className="money">Kms</th><th /></tr></thead>
                <tbody>{rec.linhas.length ? rec.linhas.map((l, k) => (
                  <tr key={k}>
                    <td><strong>{l.dia}</strong> <span className="muted small">{semana(l.dia)}</span></td>
                    <td>{l.local}<div className="muted small">{l.cidade}</div></td>
                    <td>{l.tempo}</td>
                    <td>{l.objetivo}</td>
                    <td className="money">{l.kms}</td>
                    <td>{(k === 0 || rec.linhas[k - 1].dia !== l.dia) && <button className="link-btn small" title={`Passar o dia ${l.dia} para ${mapa.recibos[1 - i].nome}`} onClick={() => trocar(l.dia)}>⇄</button>}</td>
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
  const nomes = { chalet: 'Chalet do Lago', ponteSor: 'Ponte de Sor' }
  return (
    <div className="notice" style={{ display: 'grid', gap: 8 }}>
      <div className="actions">
        <label>Firma <input value={cfg.firma} onChange={e => mudarConfig({ ...cfg, firma: e.target.value })} style={{ minWidth: 220 }} /></label>
        <label>NIF <input value={cfg.nif} onChange={e => mudarConfig({ ...cfg, nif: e.target.value })} style={{ width: 110 }} /></label>
        <label>Assinado em <input value={cfg.localAssinatura} onChange={e => mudarConfig({ ...cfg, localAssinatura: e.target.value })} style={{ width: 110 }} /></label>
        <label>Diferença máx. (€) <input type="number" step="1" min="0" value={cfg.diferencaMaxima} onChange={e => mudarConfig({ ...cfg, diferencaMaxima: Number(e.target.value) || 0 })} style={{ width: 70 }} /></label>
        <label>€ por km <input type="number" step="0.01" min="0" value={cfg.precoKm} onChange={e => mudarConfig({ ...cfg, precoKm: Number(e.target.value) || 0 })} style={{ width: 80 }} /></label>
        <label><input type="checkbox" checked={cfg.makroLinhaAParte} onChange={e => mudarConfig({ ...cfg, makroLinhaAParte: e.target.checked })} /> No dia das compras também vão ao Chalet do Lago</label>
      </div>
      {cfg.pessoas.map((p, i) => (
        <div className="actions" key={i}>
          <label>Nome <input value={p.nome} onChange={e => setPessoa(i, 'nome', e.target.value)} style={{ minWidth: 220 }} /></label>
          <label>Viatura <input value={p.viatura} onChange={e => setPessoa(i, 'viatura', e.target.value)} style={{ width: 100 }} /></label>
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
      <div><button className="link-btn" onClick={() => mudarConfig(CONFIG_PADRAO)}>Voltar às definições de origem</button></div>
    </div>
  )
}
