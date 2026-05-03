import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const RISK_COLORS = {
  CRITICAL: { bg: '#e0007a25', color: '#e0007a' },
  HIGH:     { bg: '#e0600025', color: '#e06000' },
  WARNING:  { bg: '#00c8e025', color: '#00c8e0' },
  LOW:      { bg: '#2ecc0025', color: '#2ecc00' },
  SAFE:     { bg: '#2ecc0025', color: '#2ecc00' },
}

const STALE_HOURS = 24

export default function AlertHistory({ alerts }) {
  const recent = alerts?.slice(0, 20) ?? []
  const now    = Date.now() / 1000

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold text-sm">Recent Alerts</span>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="text-2xl">✓</span>
            <p className="text-sm font-medium">All caught up</p>
            <p className="text-muted-foreground text-xs">No alerts fired yet.</p>
          </div>
        ) : (
          <ScrollArea className="h-64 pr-2">
            <div className="flex flex-col gap-3">
              {recent.map((a, i) => {
                const isStale = (now - a.sent_at) > STALE_HOURS * 3600
                const riskStyle = RISK_COLORS[a.risk_level] ?? { bg: '#e4e4e725', color: '#71717a' }
                return (
                  <div key={i} className={`border-b border-border pb-3 last:border-0 last:pb-0 ${isStale ? 'opacity-40' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold capitalize">{a.protocol}</span>
                        <Badge style={{ background: riskStyle.bg, color: riskStyle.color, border: 'none' }}>
                          {a.risk_level}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {new Date(a.sent_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">{a.message}</p>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
