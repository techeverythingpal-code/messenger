import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Auth from './pages/Auth'
import Home from './pages/Home'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) return <p className="center">Loading...</p>

  return session ? <Home session={session} /> : <Auth />
}