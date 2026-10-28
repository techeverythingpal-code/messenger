import { STATUSES, statusDot } from '../lib/status'
import { canVibrate } from '../lib/haptics'

// The bar under the title: who I am, my status, and the quick-toggle buttons.
// It only displays things. Every action is handed in from Home as a prop.
export default function ProfileBar({
  displayName,
  ready,
  status,
  onStatusChange,
  pushOn,
  onTogglePush,
  onOpenDevices,
  onOpenSettings,
  muted,
  onToggleMute,
  vibrate,
  onToggleVibrate,
}) {
  return (
    <div className="profilebar">
      <div className="who">
        <span className={`dot ${statusDot(status)}`} />
        <span className="name">{displayName}</span>
        {ready && (
          <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="tools">
        {ready && (
          <>
            <button
              className="icon"
              onClick={onTogglePush}
              title={pushOn ? 'Notifications on (click to turn off)' : 'Turn on notifications'}
            >
              {pushOn ? '🔔' : '🔕'}
            </button>
            <button className="icon" onClick={onOpenDevices} title="My devices">
              💻
            </button>
            <button className="icon" onClick={onOpenSettings} title="Settings">
              ⚙️
            </button>
          </>
        )}
        <button
          className="icon"
          onClick={onToggleMute}
          title={muted ? 'Sounds off' : 'Sounds on'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        {canVibrate() && (
          <button
            className="icon"
            onClick={onToggleVibrate}
            title={vibrate ? 'Vibration on' : 'Vibration off'}
          >
            {vibrate ? '📳' : '📴'}
          </button>
        )}
      </div>
    </div>
  )
}
