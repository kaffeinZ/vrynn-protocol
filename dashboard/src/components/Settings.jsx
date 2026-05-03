import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

const API = 'https://vrynn.xyz/api'

export default function Settings({ settings, onSaved }) {
  const { publicKey } = useWallet()
  const [hfWarning,    setHfWarning]    = useState(settings?.hf_warning    ?? 1.5)
  const [perpAlertPct, setPerpAlertPct] = useState(settings?.perp_alert_pct ?? 10)
  const [alerts,       setAlerts]       = useState(settings?.alerts_enabled  ?? 1)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const [saved,        setSaved]        = useState(false)

  async function handleSave() {
    if (!publicKey) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const auth      = JSON.parse(localStorage.getItem('vrynn_auth') || '{}')
      const signature = auth.signature
      if (!signature) throw new Error('Session expired — please reconnect your wallet')
      const res = await fetch(`${API}/settings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          address:       publicKey.toBase58(),
          signature,
          hfWarning:     parseFloat(hfWarning),
          hfCritical:    Math.max(1.0, parseFloat(hfWarning) - 0.3),
          alertsEnabled: alerts === 1,
          perpAlertPct:  parseFloat(perpAlertPct),
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
    <Card>
      <CardHeader>
        <span className="font-semibold text-sm">Alert Settings</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <Label className="text-muted-foreground text-xs">Lending alert threshold (HF)</Label>
            <span className="font-mono font-bold text-sm" style={{ color: '#e06000' }}>{parseFloat(hfWarning).toFixed(2)}</span>
          </div>
          <Slider
            value={[parseFloat(hfWarning)]}
            onValueChange={([v]) => setHfWarning(v)}
            min={1.05} max={2.5} step={0.05}
          />
          <p className="text-muted-foreground text-xs">Alert fires when lending HF drops below this</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <Label className="text-muted-foreground text-xs">Perp alert threshold</Label>
            <span className="font-mono font-bold text-sm" style={{ color: '#e0007a' }}>{parseFloat(perpAlertPct).toFixed(0)}% from liq</span>
          </div>
          <Slider
            value={[parseFloat(perpAlertPct)]}
            onValueChange={([v]) => setPerpAlertPct(v)}
            min={2} max={20} step={1}
          />
          <p className="text-muted-foreground text-xs">Alert fires when perp is within this % of liquidation</p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground text-sm">Telegram alerts</Label>
          <Switch
            checked={alerts === 1}
            onCheckedChange={(checked) => setAlerts(checked ? 1 : 0)}
          />
        </div>

        {error && <p className="text-[#e0007a] text-sm">{error}</p>}

        <div className="flex items-center justify-between">
          {saved ? <p className="text-[#2ecc00] text-xs font-medium">Saved ✓</p> : <span />}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="text-white"
            style={{ background: 'linear-gradient(90deg, #00c8e0, #7000e0)' }}
          >
            {saving ? 'Signing...' : 'Save'}
          </Button>
        </div>

      </CardContent>
    </Card>
  )
}
