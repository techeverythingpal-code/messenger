import { supabase } from '../lib/supabase'

export default function Home({ session }) {
  return (
    <div className="card">
      <h1>Welcome</h1>
      <p>Logged in as {session.user.email}</p>
      <button onClick={() => supabase.auth.signOut()}>Log out</button>
    </div>
  )
}