// src/lib/callManager.js
// Manages one voice call at a time (WebRTC).
// The screens read its state and call its functions.
//
// Exports:
//   initCallManager(userId, userName) -> cleanup function
//   startCall(peerId, peerName)
//   acceptCall()
//   rejectCall()
//   hangUp()
//   toggleMute()
//   clearNotice()
//   subscribe(listener), getState()   (used by the React hook)

import { sendSignal, listenForSignals } from './callSignaling'
import { getIceServers } from './ice'

const RING_TIMEOUT_MS = 30000 // caller waits this long for an answer
const INCOMING_TIMEOUT_MS = 45000 // incoming call stops ringing after this
const CONNECT_TIMEOUT_MS = 20000 // time allowed to connect after answering
const DISCONNECT_GRACE_MS = 8000 // time allowed to recover from a drop

const IDLE = {
  status: 'idle', // idle | calling | incoming | connecting | connected
  peerId: null,
  peerName: '',
  callId: null,
  muted: false,
  connectedAt: null,
  notice: '', // short message such as "Call declined"
}

// ---------- state (read by React) ----------

let state = IDLE
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState() {
  return state
}

export function clearNotice() {
  if (state.notice) setState({ notice: '' })
}

// ---------- internals ----------

let me = null // { id, name }
let stopListening = null
let pc = null
let localStream = null
let pendingOffer = null
let pendingCandidates = [] // received before the remote description was set
let outgoingCandidates = [] // found before our offer/answer was sent
let canSendCandidates = false
let ringTimer = null
let disconnectTimer = null

const remoteAudio = new Audio()
remoteAudio.autoplay = true

function send(peerId, callId, type, extra = {}) {
  if (!me) return
  sendSignal(peerId, { type, callId, from: me.id, ...extra }).catch(() => {})
}

function cleanup() {
  clearTimeout(ringTimer)
  clearTimeout(disconnectTimer)

  if (pc) {
    pc.onicecandidate = null
    pc.ontrack = null
    pc.onconnectionstatechange = null
    pc.close()
    pc = null
  }

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop())
    localStream = null
  }

  remoteAudio.srcObject = null
  pendingOffer = null
  pendingCandidates = []
  outgoingCandidates = []
  canSendCandidates = false
}

function endCall(notice = '') {
  cleanup()
  setState({ ...IDLE, notice })
}

// End the call from our side and tell the other person.
function finishLocally(notice = '') {
  if (state.peerId && state.callId) {
    send(state.peerId, state.callId, 'hangup')
  }
  endCall(notice)
}

async function getMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Calls need a secure (HTTPS) connection')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (err) {
    if (err && err.name === 'NotAllowedError') {
      throw new Error('Microphone permission was denied')
    }
    if (err && err.name === 'NotFoundError') {
      throw new Error('No microphone found')
    }
    throw new Error('Could not access the microphone')
  }
}

// Returns false if the call ended while we were waiting.
async function createConnection(peerId, callId) {
  const iceServers = await getIceServers()
  if (state.callId !== callId) return false

  pc = new RTCPeerConnection({ iceServers })
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream))

  pc.onicecandidate = (e) => {
    if (!e.candidate) return
    const candidate = e.candidate.toJSON()
    if (canSendCandidates) {
      send(peerId, callId, 'candidate', { candidate })
    } else {
      outgoingCandidates.push(candidate)
    }
  }

  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0]
    remoteAudio.play().catch(() => {})
  }

  pc.onconnectionstatechange = () => {
    if (!pc) return
    const s = pc.connectionState

    if (s === 'connected') {
      clearTimeout(ringTimer)
      clearTimeout(disconnectTimer)
      if (state.status !== 'connected') {
        setState({ status: 'connected', connectedAt: Date.now() })
      }
    } else if (s === 'disconnected') {
      clearTimeout(disconnectTimer)
      disconnectTimer = setTimeout(() => {
        if (pc && pc.connectionState !== 'connected') {
          finishLocally('Call lost')
        }
      }, DISCONNECT_GRACE_MS)
    } else if (s === 'failed') {
      finishLocally('Connection failed. Try another network.')
    }
  }

  return true
}

function flushOutgoingCandidates(peerId, callId) {
  canSendCandidates = true
  outgoingCandidates.forEach((candidate) =>
    send(peerId, callId, 'candidate', { candidate })
  )
  outgoingCandidates = []
}

async function addCandidate(candidate) {
  try {
    await pc.addIceCandidate(candidate)
  } catch {
    // a bad or late candidate is not fatal
  }
}

async function flushPendingCandidates() {
  const list = pendingCandidates
  pendingCandidates = []
  for (const c of list) {
    if (!pc) return
    await addCandidate(c)
  }
}

// ---------- incoming messages ----------

function onOffer(msg) {
  if (state.status !== 'idle') {
    if (msg.callId !== state.callId) {
      send(msg.from, msg.callId, 'reject', { reason: 'busy' })
    }
    return
  }

  pendingOffer = msg.sdp
  setState({
    ...IDLE,
    status: 'incoming',
    peerId: msg.from,
    peerName: msg.name || 'Unknown',
    callId: msg.callId,
  })

  ringTimer = setTimeout(() => {
    if (state.status === 'incoming') endCall('Missed call')
  }, INCOMING_TIMEOUT_MS)
}

async function onAnswer(msg) {
  if (msg.callId !== state.callId || state.status !== 'calling' || !pc) return

  try {
    clearTimeout(ringTimer)
    setState({ status: 'connecting' })
    await pc.setRemoteDescription(msg.sdp)
    await flushPendingCandidates()
    ringTimer = setTimeout(() => {
      if (state.status !== 'connected') finishLocally('Could not connect')
    }, CONNECT_TIMEOUT_MS)
  } catch {
    finishLocally('Could not connect')
  }
}

async function onCandidate(msg) {
  if (msg.callId !== state.callId || !msg.candidate) return

  if (pc && pc.remoteDescription) {
    await addCandidate(msg.candidate)
  } else {
    pendingCandidates.push(msg.candidate)
  }
}

function handleSignal(msg) {
  if (!me || !msg || msg.from === me.id) return

  switch (msg.type) {
    case 'offer':
      onOffer(msg)
      break
    case 'answer':
      onAnswer(msg)
      break
    case 'candidate':
      onCandidate(msg)
      break
    case 'reject':
      if (state.status !== 'idle' && msg.callId === state.callId) {
        endCall(msg.reason === 'busy' ? 'User is busy' : 'Call declined')
      }
      break
    case 'hangup':
      if (state.status !== 'idle' && msg.callId === state.callId) {
        endCall(state.status === 'incoming' ? 'Missed call' : 'Call ended')
      }
      break
    default:
      break
  }
}

// ---------- public functions ----------

export async function startCall(peerId, peerName) {
  if (!me || state.status !== 'idle' || peerId === me.id) return

  const callId = crypto.randomUUID()
  setState({ ...IDLE, status: 'calling', peerId, peerName, callId })

  try {
    const stream = await getMic()
    if (state.callId !== callId) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    localStream = stream

    if (!(await createConnection(peerId, callId))) return

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    if (state.callId !== callId) return

    await sendSignal(peerId, {
      type: 'offer',
      callId,
      from: me.id,
      name: me.name,
      sdp: { type: offer.type, sdp: offer.sdp },
    })
    if (state.callId !== callId) return

    flushOutgoingCandidates(peerId, callId)

    ringTimer = setTimeout(() => {
      if (state.status === 'calling') finishLocally('No answer')
    }, RING_TIMEOUT_MS)
  } catch (err) {
    if (state.callId === callId) {
      endCall(err.message || 'Could not start the call')
    }
  }
}

export async function acceptCall() {
  if (state.status !== 'incoming' || !pendingOffer) return

  const { peerId, callId } = state
  const offer = pendingOffer
  clearTimeout(ringTimer)
  setState({ status: 'connecting' })

  try {
    const stream = await getMic()
    if (state.callId !== callId) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    localStream = stream

    if (!(await createConnection(peerId, callId))) return

    await pc.setRemoteDescription(offer)
    await flushPendingCandidates()

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (state.callId !== callId) return

    await sendSignal(peerId, {
      type: 'answer',
      callId,
      from: me.id,
      sdp: { type: answer.type, sdp: answer.sdp },
    })
    if (state.callId !== callId) return

    flushOutgoingCandidates(peerId, callId)

    ringTimer = setTimeout(() => {
      if (state.status !== 'connected') finishLocally('Could not connect')
    }, CONNECT_TIMEOUT_MS)
  } catch (err) {
    if (state.callId === callId) {
      send(peerId, callId, 'reject')
      endCall(err.message || 'Could not answer the call')
    }
  }
}

export function rejectCall() {
  if (state.status !== 'incoming') return
  send(state.peerId, state.callId, 'reject')
  endCall()
}

export function hangUp() {
  if (state.status === 'idle') return
  if (state.status === 'incoming') {
    rejectCall()
    return
  }
  finishLocally()
}

export function toggleMute() {
  if (!localStream) return
  const muted = !state.muted
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = !muted
  })
  setState({ muted })
}

function onBeforeUnload() {
  if (state.status !== 'idle' && state.status !== 'incoming') {
    send(state.peerId, state.callId, 'hangup')
  }
}

// Call once after login. Returns a function that shuts everything down.
export function initCallManager(userId, userName) {
  if (stopListening) stopListening()

  me = { id: userId, name: userName || 'Someone' }
  stopListening = listenForSignals(userId, handleSignal)
  window.addEventListener('beforeunload', onBeforeUnload)

  return () => {
    if (state.status !== 'idle') hangUp()
    if (stopListening) stopListening()
    stopListening = null
    window.removeEventListener('beforeunload', onBeforeUnload)
    me = null
  }
}