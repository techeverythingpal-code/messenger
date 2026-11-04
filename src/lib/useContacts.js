import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Load my contact rows and split them into friends / incoming / outgoing
// requests (throws on error)
async function fetchContacts(userId) {
  const { data: rows, error } = await supabase
    .from('contacts')
    .select('id, requester_id, addressee_id, status, disappear_after_seconds')
  if (error) throw error

  const otherId = (r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)
  const ids = rows.map(otherId)

  let profiles = []
  if (ids.length) {
    const res = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', ids)
    if (res.error) throw res.error
    profiles = res.data
  }
  const byId = new Map(profiles.map((p) => [p.id, p]))

  const friends = []
  const incoming = []
  const outgoing = []
  for (const r of rows) {
    const p = byId.get(otherId(r))
    if (!p) continue
    const item = { rowId: r.id, expireAfter: r.disappear_after_seconds, ...p }
    if (r.status === 'accepted') friends.push(item)
    else if (r.addressee_id === userId) incoming.push(item)
    else outgoing.push(item)
  }
  return { friends, incoming, outgoing }
}

export function useContacts(userId, enabled) {
  const [lists, setLists] = useState({ friends: [], incoming: [], outgoing: [] })
  const [error, setError] = useState('')

  // Everyone in my lists, with the name I currently show for them.
  // Read inside the realtime handler without re-subscribing.
  const namesRef = useRef(new Map())
  namesRef.current = new Map(
    [...lists.friends, ...lists.incoming, ...lists.outgoing].map((p) => [p.id, p.username])
  )

  const reload = useCallback(
    () =>
      fetchContacts(userId)
        .then((next) => {
          setError('')
          setLists(next)
        })
        .catch((err) => setError(err.message)),
    [userId]
  )

  useEffect(() => {
    if (!enabled) return
    reload()
    const channel = supabase
      .channel(`contacts:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => reload())
      // A friend (or someone with a pending request) changed their username
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const p = payload.new
        if (!namesRef.current.has(p.id)) return // not one of my contacts
        if (namesRef.current.get(p.id) === p.username) return // name didn't change
        reload()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, enabled, reload])

  return { ...lists, error, reload }
}