import { useState } from 'react'

// A password box with an eye button to show / hide what was typed.
// Takes the same props as a normal <input> (value, onChange, placeholder...).
export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false)
  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        style={{ marginBottom: 0, paddingRight: 40 }}
      />
      <button
        type="button"
        className="icon"
        onClick={() => setVisible((v) => !v)}
        title={visible ? 'Hide password' : 'Show password'}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
      >
        {visible ? '🙈' : '👁️'}
      </button>
    </div>
  )
}