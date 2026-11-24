import { useMemo, useState } from 'react'
import { Empty, Panel, useToast } from '../components/ui'
import { useData } from '../data/DataProvider'
import { descarregar, XLSX_TYPE } from '../lib/ficheiros'
import { nomeMes } from '../lib/ordenados'
import { CONFIG_PADRAO, diasMakro, gerarExcel, gerarMapa, gerarPdf, juntarConfig, nomeFicheiro, SEMANA, trocarPessoa } from '../lib/mapaKms'

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
  const extra = doMes.makroExtra || []
  const tirar = doMes.makroTirar || []
  const [verDefs, setVerDefs] = useState(false)
  const [novaData, setNovaData] = useState('')
  const [busy, setBusy] = useState(false)

  const makroFaturas = useMemo(() => diasMakro(invoices, ano, m), [invoices, ano, m])
  const makro = useMemo(() => [...new Set([...makroFaturas.filter(d => !tirar.includes(d)), ...extra])].sort((a, b) => a - b), [makroFaturas, extra, tirar])
  const base = useMemo(() => gerarMapa({ ano, mes: m, makro, config: cfg, variante }), [ano, m, makro, cfg, variante])
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
  function juntarMakro() {
    if (!novaData.startsWith(`${chaveMes}-`)) return toast(`Escolhe um dia de ${nomeMes(ano, m)}.`, 'bad')
    const d = Number(novaData.slice(8, 10))
    mudarMes({ makroExtra: [...new Set([...extra, d])], makroTirar: tirar.filter(x => x !== d) })
    setNovaData('')
  }
  const tirarMakro = d => mudarMes({ makroExtra: extra.filter(x => x !== d), makroTirar: makroFaturas.includes(d) ? [...new Set([...tirar, d])] : tirar })

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
      <Panel title="Mapa de kms" hint="Compensação por deslocação em viatura própria. O mapa do mês é gerado sozinho: segunda a sábado ao Chalet do Lago, dois dias por semana a Ponte de Sor, e os dias com fatura da Makro. Cada dia é só de uma pessoa. Cada mês sai diferente."
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
          <strong>Dias da Makro em {nomeMes(ano, m)}:</strong>{' '}
          {makro.length ? makro.map(d => (
            <span key={d} style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
              {semana(d)} {d}{extra.includes(d) && !makroFaturas.includes(d) ? ' (à mão)' : ''}{' '}
              <button className="link-btn small" title="Tirar este dia da Makro" onClick={() => tirarMakro(d)}>×</button>
            </span>
          )) : <span className="muted">nenhuma fatura da Makro registada neste mês. </span>}
          <span style={{ whiteSpace: 'nowrap' }}>
            <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)} aria-label="Dia da Makro a juntar" style={{ marginLeft: 6 }} />
            <button className="secondary small" onClick={juntarMakro} disabled={!novaData}>Juntar dia</button>
          </span>
          <div className="muted small">Vêm das faturas com fornecedor "Makro" (envia-as como as outras faturas). Podes juntar um dia à mão se a fatura ainda não estiver na app.</div>
        </div>
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
  const nomes = { chalet: 'Chalet do Lago', ponteSor: 'Ponte de Sor', makro: 'Makro' }
  return (
    <div className="notice" style={{ display: 'grid', gap: 8 }}>
      <div className="actions">
        <label>Firma <input value={cfg.firma} onChange={e => mudarConfig({ ...cfg, firma: e.target.value })} style={{ minWidth: 220 }} /></label>
        <label>NIF <input value={cfg.nif} onChange={e => mudarConfig({ ...cfg, nif: e.target.value })} style={{ width: 110 }} /></label>
        <label>Assinado em <input value={cfg.localAssinatura} onChange={e => mudarConfig({ ...cfg, localAssinatura: e.target.value })} style={{ width: 110 }} /></label>
        <label>€ por km <input type="number" step="0.01" min="0" value={cfg.precoKm} onChange={e => mudarConfig({ ...cfg, precoKm: Number(e.target.value) || 0 })} style={{ width: 80 }} /></label>
        <label><input type="checkbox" checked={cfg.makroLinhaAParte} onChange={e => mudarConfig({ ...cfg, makroLinhaAParte: e.target.checked })} /> No dia da Makro também vão ao Chalet do Lago</label>
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
      <div><button className="link-btn" onClick={() => mudarConfig(CONFIG_PADRAO)}>Voltar às definições de origem</button></div>
    </div>
  )
}
