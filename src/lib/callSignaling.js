// src/lib/callSignaling.js
// Sends and receives call signals between two users using
// Supabase Realtime "broadcast" (nothing is stored in the database).
//
// Every user listens on their own channel: calls:<theirUserId>
// To signal someone, we send a message to calls:<theirUserId>.
//
// Message shape (the caller builds it):
//   { type: 'offer' | 'answer' | 'candidate' | 'reject' | 'hangup',
//     callId, from, ...extra fields (sdp, candidate, name) }

import { supabase } from './supabase'

const EVENT = 'signal'

// One send-channel per peer, kept open so later messages go out quickly
const sendChannels = new Map()

function getSendChannel(peerId) {
  const existing = sendChannels.get(peerId)
  if (existing) return existing

  const channel = supabase.channel(`calls:${peerId}`)

  const ready = new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        resolve(channel)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        sendChannels.delete(peerId)
        supabase.removeChannel(channel)
        reject(new Error('Could not reach the other user'))
      }
    })
  })

  sendChannels.set(peerId, ready)
  return ready
}

// Send one message to another user.
export async function sendSignal(peerId, message) {
  const channel = await getSendChannel(peerId)
  const result = await channel.send({
    type: 'broadcast',
    event: EVENT,
    payload: message,
  })
  if (result !== 'ok') {
    throw new Error('Signal was not delivered')
  }
}

// Start listening for messages sent to me.
// Returns a function that stops listening.
export function listenForSignals(myUserId, onSignal) {
  const channel = supabase
    .channel(`calls:${myUserId}`)
    .on('broadcast', { event: EVENT }, ({ payload }) => onSignal(payload))
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// Close all send-channels (call this on logout).
export function closeSignaling() {
  sendChannels.forEach(async (ready) => {
    try {
      const channel = await ready
      supabase.removeChannel(channel)
    } catch {
      // already closed
    }
  })
  sendChannels.clear()
}