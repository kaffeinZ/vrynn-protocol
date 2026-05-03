import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import HealthGauge from './HealthGauge'

const RISK_STYLE = {
  SAFE:     { accent: '#2ecc00', glow: 'glow-green' },
  WARNING:  { accent: '#00c8e0', glow: 'glow-cyan' },
  HIGH:     { accent: '#e06000', glow: 'glow-orange' },
  CRITICAL: { accent: '#e0007a', glow: 'glow-pink' },
}

const POSITION_TYPE_LABEL = {
  lst_loop:            'LST Loop',
  stablecoin_loop:     'Stablecoin Loop',
  volatile_collateral: 'Volatile Collateral',
  volatile_borrow:     'Volatile Borrow',
  mixed:               'Mixed',
}

function liquidationInfo(healthFactor, collateralUsd, borrowUsd) {
  if (!healthFactor || !collateralUsd || !borrowUsd) return null
  const dropPct = ((1 - (borrowUsd / collateralUsd)) * 100).toFixed(1)
  const collateralNeeded = ((borrowUsd * 2.0) - collateralUsd).toFixed(2)
  return { dropPct, collateralNeeded: Math.max(0, collateralNeeded) }
}

export default function PositionCard({ position }) {
  const { protocol, collateralUsd, borrowUsd, healthFactor, riskLevel, balances, positionType } = position
  const style = RISK_STYLE[riskLevel] ?? { accent: '#00c8e0', glow: '' }
  const info = liquidationInfo(healthFactor, collateralUsd, borrowUsd)
  const deposits = balances?.filter(b => b.assetUsd > 0.01) ?? []
  const borrows  = balances?.filter(b => b.liabilityUsd > 0.01) ?? []

  return (
    <Card className={`${style.glow} border-l-4`} style={{ borderLeftColor: style.accent }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold capitalize text-base">{protocol}</span>
            {positionType && POSITION_TYPE_LABEL[positionType] && (
              <Badge variant="secondary">{POSITION_TYPE_LABEL[positionType]}</Badge>
            )}
          </div>
          <Badge style={{ background: style.accent + '25', color: style.accent, border: 'none' }}>
            {riskLevel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted rounded-sm p-3">
            <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Collateral</p>
            <p className="font-bold text-lg">${collateralUsd?.toFixed(2) ?? '0.00'}</p>
            {deposits.map(b => (
              <p key={b.token} className="text-muted-foreground text-xs mt-0.5">{b.token}: ${b.assetUsd.toFixed(2)}</p>
            ))}
          </div>
          <div className="bg-muted rounded-sm p-3">
            <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Borrowed</p>
            <p className="font-bold text-lg">${borrowUsd?.toFixed(2) ?? '0.00'}</p>
            {borrows.map(b => (
              <p key={b.token} className="text-muted-foreground text-xs mt-0.5">{b.token}: ${b.liabilityUsd.toFixed(2)}</p>
            ))}
          </div>
        </div>

        <HealthGauge healthFactor={healthFactor} riskLevel={riskLevel} positionType={positionType} />

        {info && riskLevel !== 'SAFE' && (
          <div className="bg-muted rounded-sm p-3 flex flex-col gap-1 border border-border">
            {Number(info.dropPct) > 0 && (
              <p className="text-muted-foreground text-xs">
                Collateral can drop <span className="font-semibold text-foreground">{info.dropPct}%</span> before liquidation
              </p>
            )}
            {info.collateralNeeded > 0 && (
              <p className="text-muted-foreground text-xs">
                Add <span className="font-semibold text-foreground">${info.collateralNeeded}</span> collateral to reach safe zone
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
