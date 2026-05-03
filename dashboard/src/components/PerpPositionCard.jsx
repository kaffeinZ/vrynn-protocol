import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const RISK_STYLE = {
  SAFE:     { accent: '#2ecc00', glow: 'glow-green' },
  WARNING:  { accent: '#00c8e0', glow: 'glow-cyan' },
  HIGH:     { accent: '#e06000', glow: 'glow-orange' },
  CRITICAL: { accent: '#e0007a', glow: 'glow-pink' },
}

export default function PerpPositionCard({ position }) {
  const { protocol, token, side, leverage, entryPrice, currentPrice, liqPrice, distancePct, unrealizedPnl, sizeUsd, collateralUsd, riskLevel } = position
  const style = RISK_STYLE[riskLevel] ?? RISK_STYLE.SAFE
  const pnlPositive = unrealizedPnl >= 0
  const barWidth = Math.max(0, Math.min(100, 100 - distancePct * 2))
  const barColor = distancePct > 20 ? '#2ecc00' : distancePct > 10 ? '#e06000' : '#e0007a'

  return (
    <Card className={`${style.glow} border-l-4`} style={{ borderLeftColor: style.accent }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold capitalize text-base">{protocol}</span>
            <Badge variant="secondary">{token}-PERP</Badge>
            <Badge style={{
              background: side === 'Long' ? '#2ecc0025' : '#e0007a25',
              color: side === 'Long' ? '#2ecc00' : '#e0007a',
              border: 'none',
            }}>
              {side} {leverage}x
            </Badge>
          </div>
          <Badge style={{ background: style.accent + '25', color: style.accent, border: 'none' }}>
            {riskLevel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted rounded-sm p-3">
            <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Entry</p>
            <p className="font-bold">${entryPrice?.toFixed(2)}</p>
          </div>
          <div className="bg-muted rounded-sm p-3">
            <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Current</p>
            <p className="font-bold">${currentPrice?.toFixed(2)}</p>
          </div>
          <div className="bg-muted rounded-sm p-3">
            <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Size</p>
            <p className="font-bold">${sizeUsd?.toFixed(0)}</p>
          </div>
        </div>

        <div className="bg-muted rounded-sm p-3 flex items-center justify-between">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">Unrealised PnL</span>
          <span className="font-bold text-sm" style={{ color: pnlPositive ? '#2ecc00' : '#e0007a' }}>
            {pnlPositive ? '+' : ''}${unrealizedPnl?.toFixed(2)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Liq: <span className="font-semibold text-foreground">${liqPrice?.toFixed(2)}</span></span>
            <span className="font-semibold" style={{ color: barColor }}>{distancePct?.toFixed(1)}% away</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${barWidth}%`, backgroundColor: barColor }}
            />
          </div>
          <p className="text-muted-foreground text-xs">Collateral: <span className="text-foreground font-medium">${collateralUsd?.toFixed(2)}</span></p>
        </div>
      </CardContent>
    </Card>
  )
}
