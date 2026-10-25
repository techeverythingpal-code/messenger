import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fingerprint } from '../crypto/keys'

const fmt = (t) =>
  new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export default function Devices({ userId, deviceId, onReviewed, onBack }) {
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const reviewedRef = useRef(onReviewed)
  useEffect(() => {
    reviewedRef.current = onReviewed
  })

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('id, name, public_key, created_at, last_seen')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) {
      setError(error.message)
      return
    }
    const list = await Promise.all(
      data.map(async (d) => ({ ...d, fp: await fingerprint(d.public_key) }))
    )
    setDevices(list)
    // Looking at the list counts as reviewing: clears the new-device alert
    reviewedRef.current(list.map((d) => d.id))
  }, [userId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`devices-list:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'devices',
          filter: `user_id=eq.${userId}`,
        },
        () => load()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, load])

  async function removeDevice(d) {
    const ok = window.confirm(
      `Remove "${d.name}"?\n\n` +
        'It will stop receiving new messages, and its copies of old messages are deleted. ' +
        'If it is still signed in, it will be asked to sign out.'
    )
    if (!ok) return
    setBusy(true)
    setError('')
    setInfo('')
    const { error } = await supabase
      .from('devices')
      .delete()
      .eq('id', d.id)
      .eq('user_id', userId)
    setBusy(false)
    if (error) return setError(error.message)
    setInfo(
      `Removed "${d.name}". If you don't recognize it, also use "Sign out all other devices".`
    )
    load()
  }

  async function signOutOthers() {
    const ok = window.confirm(
      'Sign out ALL other devices and remove them from your account?\n\n' +
        'This device stays signed in. The others will need your password to log in again, ' +
        'and messages stored only on them are lost.'
    )
    if (!ok) return
    setBusy(true)
    setError('')
    setInfo('')

    // 1. Revoke the other sessions first, so they can't keep refreshing
    const { error: e1 } = await supabase.auth.signOut({ scope: 'others' })
    if (e1) {
      setBusy(false)
      return setError(e1.message)
    }

    // 2. Then remove their device keys from the account
    const { error: e2 } = await supabase
      .from('devices')
      .delete()
      .eq('user_id', userId)
      .neq('id', deviceId)
    setBusy(false)
    if (e2) return setError(e2.message)

    setInfo('Other devices were signed out and removed.')
    load()
  }

  return (
    <div>
      <div className="chat-head">
        <strong>💻 My devices</strong>
        <button className="small secondary" onClick={onBack}>← Back</button>
      </div>

      <p className="hint">
        Every message is encrypted separately for each device listed here. Remove any
        device you don't recognize.
      </p>

      {error && <p className="msg">{error}</p>}
      {info && <p className="hint">{info}</p>}
      {!devices && !error && <p>Loading...</p>}

      {devices?.map((d) => (
        <div className="device" key={d.id}>
          <div className="devtop">
            <strong>{d.name}</strong>
            {d.id === deviceId && <span className="tag-this">This device</span>}
          </div>
          <code className="fp">{d.fp}</code>
          <div className="muted">
            Added {fmt(d.created_at)} · Last used {fmt(d.last_seen)}
          </div>
          {d.id !== deviceId && (
            <button
              className="small secondary"
              style={{ marginTop: 6 }}
              disabled={busy}
              onClick={() => removeDevice(d)}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {devices && devices.length > 1 && (
        <button className="danger" style={{ marginTop: 10 }} disabled={busy} onClick={signOutOthers}>
          Sign out all other devices
        </button>
      )}
    </div>
  )
}