import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const API = 'https://vrynn.xyz/api'

const RISK_COLORS = {
  LOW:      { bg: '#2ecc0025', color: '#2ecc00' },
  MEDIUM:   { bg: '#00c8e025', color: '#00c8e0' },
  HIGH:     { bg: '#e0600025', color: '#e06000' },
  CRITICAL: { bg: '#e0007a25', color: '#e0007a' },
}

export default function AiAnalysis({ analyses = [], onResult }) {
  const { publicKey } = useWallet()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [usage,   setUsage]   = useState(null)

  async function handleAnalyze() {
    if (!publicKey) return
    setLoading(true)
    setError(null)
    try {
      const auth      = JSON.parse(localStorage.getItem('vrynn_auth') || '{}')
      const signature = auth.signature
      if (!signature) throw new Error('Session expired — please reconnect your wallet')
      const res  = await fetch(`${API}/analyze`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: publicKey.toBase58(), signature }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.usage) setUsage(data.usage)
        throw new Error(data.error)
      }
      setUsage(data.usage)
      onResult?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const remaining = usage?.remaining ?? null
  const atLimit   = remaining !== null && remaining <= 0

  return (
    <Card className="border-l-4" style={{ borderLeftColor: '#7000e0' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs uppercase tracking-wider" style={{ color: '#7000e0' }}>AI Risk Analysis</span>
          <div className="flex items-center gap-3">
            {remaining !== null && (
              <span className={`text-xs font-medium ${atLimit ? 'text-[#e0007a]' : 'text-muted-foreground'}`}>
                {remaining}/{usage.limit} today
              </span>
            )}
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={loading || atLimit}
              className="text-white text-xs"
              style={{ background: 'linear-gradient(90deg, #7000e0, #e0007a)' }}
            >
              {loading ? 'Analysing...' : atLimit ? 'Limit reached' : '✦ Analyse Risk'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {analyses.length > 0 ? (
          analyses.map((a, i) => {
            const riskStyle = RISK_COLORS[a.risk_level] ?? { bg: '#e4e4e725', color: '#71717a' }
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs capitalize">{a.protocol}</span>
                  <Badge style={{ background: riskStyle.bg, color: riskStyle.color, border: 'none' }}>
                    {a.risk_level}
                  </Badge>
                  <span className="text-muted-foreground text-xs ml-auto">
                    {new Date(a.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">{a.analysis}</p>
              </div>
            )
          })
        ) : (
          <p className="text-muted-foreground text-sm">No analysis yet — click Analyse Risk to get started.</p>
        )}

        {error && <p className="text-[#e0007a] text-xs">{error}</p>}
      </CardContent>
    </Card>
  )
}
