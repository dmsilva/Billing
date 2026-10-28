import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabaseConfigured } from './supabase'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { DataProvider } from './data/DataProvider'
import { FiltersProvider } from './data/FiltersProvider'
import { ToastProvider } from './components/ui'
import Login from './pages/Login'

const Layout = lazy(() => import('./components/Layout'))
const Rececao = lazy(() => import('./pages/Rececao'))
const NovaPassword = lazy(() => import('./pages/NovaPassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Resultados = lazy(() => import('./pages/Resultados'))
const Analise = lazy(() => import('./pages/Analise'))
const Movimentos = lazy(() => import('./pages/Movimentos'))
const Faturas = lazy(() => import('./pages/Faturas'))
const FaturaEditor = lazy(() => import('./pages/FaturaEditor'))
const PorLiquidar = lazy(() => import('./pages/PorLiquidar'))
const Entradas = lazy(() => import('./pages/Entradas'))
const Produtos = lazy(() => import('./pages/Produtos'))
const Categorias = lazy(() => import('./pages/Categorias'))
const EditarCategorias = lazy(() => import('./pages/EditarCategorias'))
const Caixa = lazy(() => import('./pages/Caixa'))
const Conferencia = lazy(() => import('./pages/Conferencia'))
const Utilizadores = lazy(() => import('./pages/Utilizadores'))
const Configuracao = lazy(() => import('./pages/Configuracao'))
const Ordenados = lazy(() => import('./pages/Ordenados'))
const Perguntar = lazy(() => import('./pages/Perguntar'))
const Saft = lazy(() => import('./pages/Saft'))

const Loading = () => <div className="center-screen"><div className="spinner" />A carregar…</div>

function MissingConfig() {
  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="brand dark"><strong>Fatura<span>Claro</span></strong></div>
        <h2>Falta configurar o Supabase</h2>
        <p className="muted">Define as variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (no ficheiro <code>.env</code> ou nas variáveis de ambiente do Netlify) e volta a publicar.</p>
        <p className="muted">Para experimentar no computador sem Supabase, corre <code>npm run local</code>.</p>
      </div>
    </div>
  )
}

function Pending() {
  const { profile, signOut, reloadProfile } = useAuth()
  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="brand dark"><strong>Fatura<span>Claro</span></strong></div>
        <h2>Conta à espera de aprovação</h2>
        <p className="muted">A conta <strong>{profile?.email}</strong> foi criada, mas a administradora ainda não lhe atribuiu acesso.</p>
        <div className="actions">
          <button className="primary" onClick={reloadProfile}>Verificar novamente</button>
          <button className="secondary" onClick={signOut}>Terminar sessão</button>
        </div>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading, role } = useAuth()
  const loc = useLocation()
  if (loc.pathname === '/nova-password') return <NovaPassword />
  if (loading) return <Loading />
  if (!session) return <Login />
  if (role === 'pendente' || !role) return <Pending />
  if (loc.pathname.startsWith('/rececao')) return <Rececao />
  if (role !== 'admin') return <Navigate to="/rececao" replace />
  return (
    <DataProvider>
      <FiltersProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="resultados" element={<Resultados />} />
            <Route path="analise" element={<Analise />} />
            <Route path="perguntar" element={<Perguntar />} />
            <Route path="movimentos" element={<Movimentos />} />
            <Route path="entradas" element={<Entradas />} />
            <Route path="faturas" element={<Faturas />} />
            <Route path="faturas/nova" element={<FaturaEditor />} />
            <Route path="faturas/:id" element={<FaturaEditor />} />
            <Route path="numerario" element={<Navigate to="/faturas?tab=numerario" replace />} />
            <Route path="recebidas" element={<Navigate to="/faturas" replace />} />
            <Route path="por-liquidar" element={<PorLiquidar />} />
            <Route path="produtos" element={<Produtos />} />
            <Route path="categorias" element={<Categorias />} />
            <Route path="editar-categorias" element={<EditarCategorias />} />
            <Route path="saft" element={<Saft />} />
            <Route path="caixa" element={<Caixa />} />
            <Route path="conferencia" element={<Conferencia />} />
            <Route path="ordenados" element={<Ordenados />} />
            <Route path="utilizadores" element={<Utilizadores />} />
            <Route path="configuracao" element={<Configuracao />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </FiltersProvider>
    </DataProvider>
  )
}

export default function App() {
  if (!supabaseConfigured) return <MissingConfig />
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<Loading />}>
          <Gate />
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  )
}
