import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data/DataProvider'
import { localMode } from '../supabase'
import { isUnpaid } from '../lib/finance'

export const PAGES = [
  { section: 'GESTÃO' },
  { path: '/', label: 'Visão geral', icon: '▦', title: 'Visão geral', sub: 'Controlo mensal · entradas e saídas' },
  { path: '/resultados', label: 'Resultados', icon: '±', title: 'Resultados', sub: 'Faturado − despesas = lucro · mês a mês e no ano' },
  { path: '/analise', label: 'Análise', icon: '◔', title: 'Análise', sub: 'Por fornecedor, categoria, produto e imóvel' },
  { section: 'ENTRADAS' },
  { path: '/caixa', label: 'Caixa diária', icon: '▣', title: 'Caixa diária', sub: 'Fechos dos colaboradores · 7h · 15h · 23h' },
  { path: '/entradas', label: 'Entradas no banco', icon: '↘', title: 'Entradas no banco', sub: 'Expedia, Stripe, transferências de hóspedes · transferências da receção', badge: 'transferencias' },
  { path: '/conferencia', label: 'Conferência', icon: '✓', title: 'Conferência', sub: 'CV → MB → Numerário → próximo envelope' },
  { section: 'MOVIMENTOS' },
  { path: '/movimentos', label: 'CGD / Extrato', icon: '▤', title: 'CGD / Extrato', sub: 'Todas as saídas da conta bancária CGD' },
  { path: '/faturas', label: 'Faturas', icon: '▧', title: 'Faturas', sub: 'Documentos, ficheiros originais e linhas de produtos' },
  { path: '/numerario', label: 'Numerário', icon: '◉', title: 'Numerário', sub: 'Faturas e recibos pagos em dinheiro' },
  { path: '/recebidas', label: 'Recebidas', icon: '✉', title: 'Faturas recebidas', sub: 'Enviadas pela receção · por validar', badge: 'recebidas' },
  { path: '/por-liquidar', label: 'Por liquidar', icon: '🕓', title: 'Por liquidar', sub: 'Faturas por pagar e pagamentos agrupados', badge: 'por-liquidar' },
  { section: 'ANÁLISE' },
  { path: '/produtos', label: 'Produtos', icon: '◌', title: 'Produtos', sub: 'Consumo e gasto por artigo' },
  { path: '/categorias', label: 'Categorias', icon: '◈', title: 'Categorias', sub: 'Despesas por categoria · CGD e numerário' },
  { path: '/editar-categorias', label: 'Editar categorias', icon: '⚙', title: 'Editar categorias', sub: 'Classificação das saídas CGD' },
  { section: 'ADMINISTRAÇÃO' },
  { path: '/utilizadores', label: 'Utilizadores', icon: '☺', title: 'Utilizadores', sub: 'Acessos da administradora e da receção' },
  { path: '/configuracao', label: 'Dados e migração', icon: '⛁', title: 'Dados e migração', sub: 'Validação dos dados migrados e importação do navegador antigo' },
]

export function pageFor(pathname) {
  const p = PAGES.filter(x => x.path).sort((a, b) => b.path.length - a.path.length).find(x => (x.path === '/' ? pathname === '/' : pathname.startsWith(x.path)))
  return p || PAGES[1]
}

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

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { invoices, transferencias, online, error, loading } = useData()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const page = pageFor(loc.pathname)
  const pendingReceived = invoices.filter(i => i.origem === 'rececao' && i.estado === 'Por validar').length
  const unpaid = invoices.filter(isUnpaid).length
  const unallocated = transferencias.filter(t => !t.alocada_em).length

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand"><strong>Fatura<span>Claro</span></strong><small>Gestão financeira</small></div>
          <button className="menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {PAGES.map((p, i) =>
            p.section ? <div className="nav-section" key={i}>{p.section}</div> : (
              <NavLink key={p.path} to={p.path} end={p.path === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="nav-icon">{p.icon}</span>{p.label}
                {p.badge === 'recebidas' && pendingReceived > 0 && <b className="nav-badge">{pendingReceived}</b>}
                {p.badge === 'por-liquidar' && unpaid > 0 && <b className="nav-badge">{unpaid}</b>}
                {p.badge === 'transferencias' && unallocated > 0 && <b className="nav-badge" title="Transferências por alocar">{unallocated}</b>}
              </NavLink>
            ),
          )}
          <a href="/rececao" {...(localMode ? {} : { target: '_blank', rel: 'noreferrer' })}><span className="nav-icon">📷</span>Página da receção ↗</a>
        </nav>
        <div className="sidebar-foot">
          {localMode
            ? <div className="sync off">● Modo local (só neste navegador)</div>
            : <div className={`sync ${online ? 'on' : 'off'}`}>{online ? '● Sincronizado' : '○ A ligar…'}</div>}
          <div className="who">{profile?.nome || profile?.email}</div>
          <button className="link-btn light" onClick={signOut}>Terminar sessão</button>
        </div>
      </aside>
      <main className="content">
        <div className="top">
          <div>
            <h1>{page.title}</h1>
            <div className="sub">{page.sub}</div>
          </div>
          <button className="primary" onClick={() => nav('/faturas/nova')}>+ Adicionar fatura</button>
        </div>
        {localMode && <LocalBanner />}
        {error && <div className="notice bad">Erro ao comunicar com o Supabase: {error}</div>}
        {loading ? <div className="notice">A carregar dados…</div> : <Outlet />}
      </main>
    </div>
  )
}
