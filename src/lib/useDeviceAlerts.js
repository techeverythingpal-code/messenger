import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { getJSON, setJSON } from './storage'

// Which of my devices I have already seen, kept on this device only
// (null = this device has never recorded any)
const readSeen = (userId) => {
  const v = getJSON(`devices-seen:${userId}`, null)
  return Array.isArray(v) ? v : null
}
const writeSeen = (userId, ids) => setJSON(`devices-seen:${userId}`, ids)

// Warns me when a new device is added to my account (a security feature).
//   alertDevices → devices added that I haven't acknowledged: [{ id, name }]
//   handleReviewed(ids) → call after I've reviewed my device list
//   dismissAlert() → "It was me": remember these devices as seen
export function useDeviceAlerts({ userId, deviceId, ready }) {
  const [alertDevices, setAlertDevices] = useState([])

  useEffect(() => {
    if (!ready) return
    let cancelled = false

    // Devices added while this device was closed
    supabase
      .from('devices')
      .select('id, name')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled || !data) return
        const seen = readSeen(userId)
        if (seen === null) {
          writeSeen(userId, data.map((d) => d.id)) // first run on this device: nothing to compare yet
          return
        }
        const fresh = data.filter((d) => d.id !== deviceId && !seen.includes(d.id))
        if (fresh.length) setAlertDevices(fresh)
      })

    // Devices added while this device is open
    const channel = supabase
      .channel(`mydevices:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'devices',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const d = payload.new
          if (d.id === deviceId) return
          setAlertDevices((prev) =>
            prev.some((x) => x.id === d.id) ? prev : [...prev, { id: d.id, name: d.name }]
          )
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [ready, userId, deviceId])

  const handleReviewed = useCallback(
    (ids) => {
      writeSeen(userId, ids)
      setAlertDevices([])
    },
    [userId]
  )

  function dismissAlert() {
    const seen = readSeen(userId) || []
    writeSeen(userId, [...new Set([...seen, ...alertDevices.map((d) => d.id)])])
    setAlertDevices([])
  }

  return { alertDevices, handleReviewed, dismissAlert }
}