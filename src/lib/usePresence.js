import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Returns a Set of user IDs that are currently online
export function usePresence(userId, enabled) {
  const [online, setOnline] = useState(new Set())

  useEffect(() => {
    if (!enabled) return
    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, enabled])

  return online
}