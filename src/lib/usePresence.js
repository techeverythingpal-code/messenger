import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Returns a Map of userId -> 'available' | 'busy' for everyone currently online.
// Users who choose "invisible" simply don't appear.
export function usePresence(userId, enabled, myStatus) {
  const [online, setOnline] = useState(new Map())
  const channelRef = useRef(null)
  const readyRef = useRef(false)
  const statusRef = useRef(myStatus)

  const announce = useCallback(async () => {
    const channel = channelRef.current
    if (!channel || !readyRef.current) return
    try {
      if (statusRef.current === 'invisible') await channel.untrack()
      else await channel.track({ status: statusRef.current })
    } catch {
      /* presence is best-effort */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    })
    channelRef.current = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const next = new Map()
        for (const [id, metas] of Object.entries(channel.presenceState())) {
          const last = metas[metas.length - 1]
          next.set(id, last?.status === 'busy' ? 'busy' : 'available')
        }
        setOnline(next)
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          readyRef.current = true
          announce()
        }
      })

    return () => {
      readyRef.current = false
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [userId, enabled, announce])

  useEffect(() => {
    statusRef.current = myStatus
    announce()
  }, [myStatus, announce])

  return online
}