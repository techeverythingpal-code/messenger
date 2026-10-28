import { useEffect, useState } from 'react'
import { pushSupported, pushStatus, enablePush, disablePush } from './push'
import { isVibrateOn, setVibrateOn, testVibrate } from './haptics'

// Notification and vibration switches for this device.
//   pushOn / togglePush()   → push notifications on or off for this device
//   vibrate / toggleVibrate() → vibration on new messages
//   pushMsg → a short status or help message to show the user (or '')
export function usePushSettings({ userId, deviceId, ready }) {
  const [pushOn, setPushOn] = useState(false)
  const [vibrate, setVibrate] = useState(isVibrateOn)
  const [pushMsg, setPushMsg] = useState('')

  // Ask the server whether this device is already subscribed
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    pushStatus(userId, deviceId)
      .then((on) => !cancelled && setPushOn(on))
      .catch(() => !cancelled && setPushOn(false))
    return () => {
      cancelled = true
    }
  }, [ready, userId, deviceId])

  async function togglePush() {
    setPushMsg('')
    if (!pushSupported()) {
      setPushMsg(
        "Notifications aren't available in this browser. On iPhone or iPad, tap Share → " +
          'Add to Home Screen first, then open the app from the Home Screen.'
      )
      return
    }
    try {
      if (pushOn) {
        await disablePush(userId, deviceId)
        setPushOn(false)
        setPushMsg('Notifications are off for this device.')
      } else {
        await enablePush(userId, deviceId)
        setPushOn(true)
        setPushMsg('Notifications are on for this device.')
      }
    } catch (e) {
      setPushMsg(e.message)
    }
  }

  function toggleVibrate() {
    const next = !vibrate
    setVibrateOn(next)
    setVibrate(next)
    if (!next) {
      setPushMsg('Vibration is off.')
      return
    }
    const result = testVibrate()
    setPushMsg(
      result === 'sent'
        ? 'Test vibration sent. If you felt nothing, check your phone: silent mode, Do Not Disturb, battery saver, or the system vibration and haptic settings.'
        : result === 'unsupported'
          ? "This browser can't vibrate. Use Chrome or Edge on Android."
          : 'The browser blocked the vibration. Tap the page, keep this tab in front, and try again.'
    )
  }

  return { pushOn, pushMsg, togglePush, vibrate, toggleVibrate }
}
