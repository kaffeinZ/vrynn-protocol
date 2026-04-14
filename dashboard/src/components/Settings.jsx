import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'

const API = 'http://localhost:3001/api'

export default function Settings({ settings, onSaved }) {
  const { publicKey, signMessage } = useWallet()
  const [hfWarning,  setHfWarning]  = useState(settings?.hf_warning  ?? 1.5)
  const [hfCritical, setHfCritical] = useState(settings?.hf_critical ?? 1.2)
  const [alerts,     setAlerts]     = useState(settings?.alerts_enabled ?? 1)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState(null)
  const [saved,      setSaved]      = useState(false)

  async function handleSave() {
    if (!publicKey || !signMessage) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const { message } = await fetch(`${API}/auth/message`).then(r => r.json())
      const signature   = bs58.encode(await signMessage(new TextEncoder().encode(message)))

      const res  = await fetch(`${API}/settings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          address:       publicKey.toBase58(),
          signature,
          hfWarning:     parseFloat(hfWarning),
          hfCritical:    parseFloat(hfCritical),
          alertsEnabled: alerts === 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaved(true)
      onSaved?.(data.settings)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-5">
      <h2 className="text-zinc-300 font-semibold">Alert Settings</h2>

      {/* Warning threshold */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <label className="text-zinc-400">Warning threshold</label>
          <span className="text-yellow-400 font-mono">{parseFloat(hfWarning).toFixed(2)}</span>
        </div>
        <input type="range" min="1.1" max="3.0" step="0.05"
          value={hfWarning}
          onChange={e => setHfWarning(e.target.value)}
          className="w-full accent-yellow-400"
        />
        <p className="text-zinc-500 text-xs">Alert fires when HF drops below this</p>
      </div>

      {/* Critical threshold */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <label className="text-zinc-400">Critical threshold</label>
          <span className="text-red-400 font-mono">{parseFloat(hfCritical).toFixed(2)}</span>
        </div>
        <input type="range" min="1.0" max="1.5" step="0.05"
          value={hfCritical}
          onChange={e => setHfCritical(e.target.value)}
          className="w-full accent-red-400"
        />
        <p className="text-zinc-500 text-xs">Must be lower than warning threshold</p>
      </div>

      {/* Alerts toggle */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 text-sm">Telegram alerts</span>
        <button
          onClick={() => setAlerts(alerts === 1 ? 0 : 1)}
          className={`w-12 h-6 rounded-full transition-colors ${alerts === 1 ? 'bg-green-500' : 'bg-zinc-600'}`}
        >
          <div className={`w-5 h-5 bg-white rounded-full mx-0.5 transition-transform ${alerts === 1 ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {saved && <p className="text-green-400 text-sm">Settings saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-white text-black font-semibold py-2 rounded-lg hover:bg-zinc-200 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Signing...' : 'Save Settings'}
      </button>
    </div>
  )
}
