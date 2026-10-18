import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async user => {
    if (!user) { setProfile(null); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (error) setProfileError(error.message)
    setProfile(data || { id: user.id, email: user.email, role: 'pendente' })
  }, [])

  useEffect(() => {
    if (session !== undefined) loadProfile(session?.user)
  }, [session, loadProfile])

  const value = {
    session,
    user: session?.user || null,
    profile,
    profileError,
    role: profile?.role || null,
    isAdmin: profile?.role === 'admin',
    loading: session === undefined || (session && !profile),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
    resetPassword: email => supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/nova-password` }),
    updatePassword: password => supabase.auth.updateUser({ password }),
    reloadProfile: () => loadProfile(session?.user),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
