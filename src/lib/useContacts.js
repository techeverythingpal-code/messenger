import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useContacts(userId, enabled) {
  const [lists, setLists] = useState({ friends: [], incoming: [], outgoing: [] })
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('contacts')
      .select('id, requester_id, addressee_id, status')
    if (error) return setError(error.message)

    const otherId = (r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)
    const ids = rows.map(otherId)

    let profiles = []
    if (ids.length) {
      const res = await supabase
        .from('profiles')
        .select('id, username, public_key')
        .in('id', ids)
      if (res.error) return setError(res.error.message)
      profiles = res.data
    }
    const byId = new Map(profiles.map((p) => [p.id, p]))

    const friends = []
    const incoming = []
    const outgoing = []
    for (const r of rows) {
      const p = byId.get(otherId(r))
      if (!p) continue
      const item = { rowId: r.id, ...p }
      if (r.status === 'accepted') friends.push(item)
      else if (r.addressee_id === userId) incoming.push(item)
      else outgoing.push(item)
    }
    setError('')
    setLists({ friends, incoming, outgoing })
  }, [userId])

  useEffect(() => {
    if (!enabled) return
    reload()
    const channel = supabase
      .channel(`contacts:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => reload())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, enabled, reload])

  return { ...lists, error, reload }
}