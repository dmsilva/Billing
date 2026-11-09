import { useEffect, useState } from 'react'
import InstallApp from './InstallApp'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AutoConferencia from './AutoConferencia'
import ArrastarFaturas, { EMAIL_SAVED_EVENT } from './ArrastarFaturas'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { localMode, supabase } from '../supabase'
import { deveImportarAuto, importarCaixasApp } from '../data/caixasApp'

export const EMAIL_QUEUE_EVENT = 'fatura-chalet:fila-email-mudou'
import { isUnpaid } from '../lib/finance'

// Menu: cada entrada é uma página; as que têm vários separadores mostram-nos por baixo do título.
export const PAGES = [
  { section: 'RESUMO' },
  { label: 'Visão geral', icon: '▦', title: 'Visão geral', tabs: [
    { path: '/', label: 'Visão geral', sub: 'Faturado, despesas e lucro · o que precisa de atenção' },
  ] },
  { label: 'Resultados', icon: '±', title: 'Resultados', tabs: [
    { path: '/resultados', label: 'Resultados', sub: 'Faturado − despesas = lucro · mês a mês, no ano e bónus' },
  ] },
  { label: 'Análise', icon: '◔', title: 'Análise', tabs: [
    { path: '/analise', label: 'Fornecedor · categoria · imóvel', sub: 'Onde está a sair o dinheiro · clica numa linha para ver a evolução' },
    { path: '/produtos', label: 'Produtos', sub: 'Gasto e consumo por artigo das faturas · pequeno-almoço' },
  ] },
  { label: 'Perguntar', icon: '?', title: 'Perguntar', tabs: [
    { path: '/perguntar', label: 'Perguntar', sub: 'Pergunta em linguagem normal e recebe a resposta com os dados reais' },
  ] },
  { section: 'DINHEIRO' },
  { label: 'Caixas', icon: '◫', title: 'Caixas', tabs: [
    { path: '/caixas-rececao', label: 'App da receção', badge: 'caixas', sub: 'Turnos da app de caixa · envelopes, talão do TPA e plataformas' },
    { path: '/caixa', label: 'Fechos por dia', sub: 'Todos os fechos de caixa · totais por mês · importar o Excel antigo' },
    { path: '/conferencia', label: 'Conferir fechos antigos', sub: 'Fechos do Excel · CV → MB → Numerário → próximo envelope' },
  ] },
  { label: 'Banco CGD', icon: '▤', title: 'Banco CGD', tabs: [
    { path: '/movimentos', label: 'Saídas', sub: 'Todas as saídas da conta CGD · importar o extrato' },
    { path: '/entradas', label: 'Entradas', badge: 'transferencias', sub: 'Expedia, Stripe, transferências de hóspedes e da receção' },
  ] },
  { label: 'Faturas', icon: '▧', title: 'Faturas', tabs: [
    { path: '/faturas', label: 'Faturas', badge: 'recebidas', sub: 'Receção, numerário e conferência com o extrato' },
    { path: '/faturas-email', label: 'Do email', badge: 'email', sub: 'PDFs de faturas que chegam ao email · rever e gravar' },
    { path: '/por-liquidar', label: 'Por pagar', badge: 'por-liquidar', sub: 'Faturas ainda por pagar e pagamentos agrupados' },
  ] },
  { label: 'Categorias e regras', icon: '⚙', title: 'Categorias e regras', tabs: [
    { path: '/editar-categorias', label: 'Categorias e regras', sub: 'Classificar as saídas CGD · regras por fornecedor' },
  ] },
  { section: 'PESSOAL E DEFINIÇÕES' },
  { label: 'Ordenados', icon: '☷', title: 'Ordenados', tabs: [
    { path: '/ordenados', label: 'Para a contabilidade', sub: 'Folha para a contabilidade a partir do horário' },
    { path: '/salarios-banco', label: 'Ficheiro para o banco', sub: 'Recibos do contabilista → ficheiro de salários para a CGD' },
  ] },
  { label: 'Definições', icon: '⛁', title: 'Definições', tabs: [
    { path: '/utilizadores', label: 'Utilizadores', sub: 'Acessos da administradora e da receção' },
    { path: '/configuracao', label: 'Imóveis e dados', sub: 'Imóveis, validação dos dados migrados e importação do navegador antigo' },
  ] },
]

const matches = (path, pathname) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`))

// Página (entrada do menu) e separador do endereço atual.
export function pageFor(pathname) {
  for (const page of PAGES) {
    const tab = page.tabs?.find(t => matches(t.path, pathname))
    if (tab) return { page, tab }
  }
  return { page: PAGES[1], tab: PAGES[1].tabs[0] }
}

// Páginas onde se importam outros ficheiros (extratos, caixas, recibos) ou se anexa a uma fatura existente:
// aí largar um ficheiro não cria uma fatura nova.
const NO_GLOBAL_DROP = ['/movimentos', '/entradas', '/caixa', '/caixas-rececao', '/ordenados', '/salarios-banco', '/configuracao', '/faturas/']

function LocalBanner() {
  async function reset() {
    if (!window.confirm('Apagar todas as alterações feitas em modo local e voltar aos dados originais?')) return
    const { resetLocalDatabase } = await import('../local/localClient')
    await resetLocalDatabase()
    window.location.assign('/')
  }
  return (
    <div className="notice local-banner">
      <span><strong>Modo local.</strong> Os dados reais migrados estão numa base de dados dentro deste navegador. As alterações ficam só aqui e não chegam ao Supabase. Usa apenas um separador de cada vez.</span>
      <button className="secondary" onClick={reset}>Repor dados originais</button>
    </div>
  )
}

// Quantas faturas do email estão por tratar (atualiza a cada 5 minutos e quando a fila muda).
function useEmailPending(enabled) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled || !supabase) return
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.from('email_faturas').select('id').eq('estado', 'pendente').limit(500)
      if (alive) setN(error ? 0 : (data || []).length)
    }
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    window.addEventListener(EMAIL_SAVED_EVENT, load)
    window.addEventListener(EMAIL_QUEUE_EVENT, load)
    return () => { alive = false; clearInterval(t); window.removeEventListener(EMAIL_SAVED_EVENT, load); window.removeEventListener(EMAIL_QUEUE_EVENT, load) }
  }, [enabled])
  return n
}

// Vai buscar as caixas da app da receção sozinha (no máximo uma vez por hora).
function useCaixasAuto(enabled) {
  const { caixasAppReady, loading, reload } = useData()
  useEffect(() => {
    if (!enabled || loading || !caixasAppReady || localMode || !deveImportarAuto()) return
    importarCaixasApp().then(r => {
      if (!r?.error && r?.dias) for (const t of ['caixa_app_dias', 'caixa_app_turnos', 'caixa_app_pendentes', 'cash_closes', 'cash_imports']) reload(t)
    })
  }, [enabled, loading, caixasAppReady, reload])
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { invoices, transferencias, caixa_app_turnos, online, error, loading } = useData()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const { page, tab } = pageFor(loc.pathname)
  const pendingReceived = invoices.filter(i => i.estado === 'Por validar').length
  const unpaid = invoices.filter(isUnpaid).length
  const unallocated = transferencias.filter(t => !t.alocada_em).length
  const emailPending = useEmailPending(profile?.role === 'admin')
  useCaixasAuto(profile?.role === 'admin')
  const envelopes = caixa_app_turnos.filter(t => t.fechado && t.envelope_recebido == null).length
  const badges = {
    recebidas: { n: pendingReceived, title: 'Faturas por confirmar' },
    'por-liquidar': { n: unpaid, title: 'Faturas por pagar' },
    email: { n: emailPending, title: 'Faturas do email por tratar' },
    caixas: { n: envelopes, title: 'Envelopes por conferir' },
    transferencias: { n: unallocated, title: 'Transferências por alocar' },
  }
  const badgeOf = t => (t.badge && badges[t.badge]?.n > 0 ? badges[t.badge] : null)

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand"><strong>Fatura <span>Chalet</span></strong><small>Gestão financeira</small></div>
          <button className="menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {PAGES.map((p, i) => {
            if (p.section) return <div className="nav-section" key={i}>{p.section}</div>
            const active = p === page
            const marks = p.tabs.map(badgeOf).filter(Boolean)
            return (
              <NavLink key={p.label} to={p.tabs[0].path} end={p.tabs[0].path === '/'} className={active ? 'active' : ''}>
                <span className="nav-icon">{p.icon}</span>{p.label}
                {marks.length > 0 && <b className="nav-badge" title={marks.map(b => `${b.title}: ${b.n}`).join(' · ')}>{marks.reduce((a, b) => a + b.n, 0)}</b>}
              </NavLink>
            )
          })}
          <a href="/rececao" {...(localMode ? {} : { target: '_blank', rel: 'noreferrer' })}><span className="nav-icon">📷</span>Página da receção ↗</a>
        </nav>
        <div className="sidebar-foot">
          {localMode
            ? <div className="sync off">● Modo local (só neste navegador)</div>
            : <div className={`sync ${online ? 'on' : 'off'}`}>{online ? '● Sincronizado' : '○ A ligar…'}</div>}
          <div className="who">{profile?.nome || profile?.email}</div>
          <button className="link-btn light" onClick={signOut}>Terminar sessão</button>
          <InstallApp className="dark" />
        </div>
      </aside>
      <main className="content">
        <div className="top">
          <div>
            <h1>{page.title}</h1>
            <div className="sub">{tab.sub}</div>
          </div>
          <button className="primary" onClick={() => nav('/faturas/nova')}>+ Adicionar fatura</button>
        </div>
        {page.tabs.length > 1 && (
          <nav className="page-tabs" aria-label={page.title}>
            {page.tabs.map(t => {
              const b = badgeOf(t)
              return (
                <NavLink key={t.path} to={t.path} className={t === tab ? 'on' : ''}>
                  {t.label}{b && <b className="nav-badge" title={b.title}>{b.n}</b>}
                </NavLink>
              )
            })}
          </nav>
        )}
        <AutoConferencia />
        {!loading && <ArrastarFaturas dropAnywhere={!NO_GLOBAL_DROP.some(x => loc.pathname.startsWith(x))} />}
        {localMode && <LocalBanner />}
        {error && <div className="notice bad">Erro ao comunicar com o Supabase: {error}</div>}
        {loading ? <div className="notice">A carregar dados…</div> : <Outlet />}
      </main>
    </div>
  )
}
