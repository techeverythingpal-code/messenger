import { useEffect, useState } from 'react'
import { supabase, openedFromRecoveryLink } from './lib/supabase'
import Auth from './pages/Auth'
import Home from './pages/Home'
import SetNewPassword from './pages/SetNewPassword'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(openedFromRecoveryLink)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      // A recovery link that didn't produce a session (expired link): forget it
      if (!data.session) setRecovery(false)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) return <p className="center">Loading...</p>

  // Opened from a reset email: ask for the new password before anything else
  if (recovery && session) return <SetNewPassword onDone={() => setRecovery(false)} />

  return session ? <Home session={session} /> : <Auth />
}