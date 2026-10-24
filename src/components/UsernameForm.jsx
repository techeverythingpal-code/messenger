import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function UsernameForm({ userId, onSaved }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg('')
    const u = name.trim().toLowerCase()

    if (!/^[a-z0-9_]{3,20}$/.test(u)) {
      setMsg('Use 3-20 characters: letters, numbers or underscore.')
      return
    }

    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ username: u })
      .eq('id', userId)
    setBusy(false)

    if (error) {
      setMsg(error.code === '23505' ? 'That username is taken.' : error.message)
      return
    }
    onSaved(u)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Choose your username</h2>
      <p className="hint">Friends will find you by this name. You can't change it later.</p>
      <input
        placeholder="e.g. alice_92"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={20}
        autoComplete="off"
      />
      <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save username'}</button>
      {msg && <p className="msg">{msg}</p>}
    </form>
  )
}