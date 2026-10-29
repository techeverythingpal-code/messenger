// src/hooks/useCall.js
// Connects React screens to the call manager.
//
// Usage:
//   const { call, startCall, acceptCall, rejectCall, hangUp,
//           toggleMute, clearNotice } = useCall()
//
// call.status is one of:
//   'idle' | 'calling' | 'incoming' | 'connecting' | 'connected'

import { useSyncExternalStore } from 'react'
import {
  subscribe,
  getState,
  startCall,
  acceptCall,
  rejectCall,
  hangUp,
  toggleMute,
  clearNotice,
} from '../lib/callManager'

export default function useCall() {
  const call = useSyncExternalStore(subscribe, getState)

  return {
    call,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    clearNotice,
  }
}