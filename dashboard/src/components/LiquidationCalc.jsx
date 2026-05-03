import { useState } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'

const STABLE = new Set(['USDC', 'USDT', 'USDH', 'USDS', 'UXD', 'UST', 'DAI', 'PYUSD', 'USDe', 'EUSD'])

function hfColor(hf) {
  if (hf === null) return '#2ecc00'
  if (hf >= 2.0)  return '#2ecc00'
  if (hf >= 1.5)  return '#00c8e0'
  if (hf >= 1.2)  return '#e06000'
  return '#e0007a'
}

function hfLabel(hf) {
  if (hf === null) return 'SAFE'
  if (hf === 0)   return 'LIQUIDATED'
  if (hf >= 2.0)  return 'SAFE'
  if (hf >= 1.5)  return 'WARNING'
  if (hf >= 1.2)  return 'HIGH'
  return 'CRITICAL'
}

function projectHf(pos, dropFraction) {
  if (pos.healthFactor === null) return null
  if (pos.positionType === 'perp') {
    if (!pos.currentPrice || !pos.liqPrice) return pos.healthFactor
    const stressedPrice = pos.currentPrice * (1 - dropFraction)
    if (stressedPrice <= pos.liqPrice) return 0
    const newDistancePct = (stressedPrice - pos.liqPrice) / stressedPrice * 100
    return newDistancePct / 5
  }
  if (dropFraction === 0) return pos.healthFactor
  const { balances, positionType } = pos
  const hasTokenPrices = balances?.some(b => b.priceUsd > 0)
  if (hasTokenPrices) {
    const totalWeightedLiabs = balances.reduce((s, b) => s + (b.weightedLiabUsd ?? 0), 0)
    if (totalWeightedLiabs === 0) return null
    const newWeightedAssets = balances.reduce((s, b) => {
      const isStable = STABLE.has(b.token)
      const isCollateral = (b.assetUsd ?? 0) > 0.01
      const scale = (isCollateral && !isStable) ? (1 - dropFraction) : 1
      return s + (b.weightedAssetUsd ?? 0) * scale
    }, 0)
    return newWeightedAssets / totalWeightedLiabs
  }
  if (positionType === 'lst_loop' || positionType === 'stablecoin_loop') return pos.healthFactor
  if (positionType === 'volatile_borrow') return pos.healthFactor / (1 + dropFraction)
  return pos.healthFactor * (1 - dropFraction)
}

function liquidationPrices(pos) {
  const { balances, healthFactor } = pos
  if (!balances || healthFactor === null) return []
  const hasTokenPrices = balances.some(b => b.priceUsd > 0)
  if (!hasTokenPrices) return []
  const totalWeightedLiabs  = balances.reduce((s, b) => s + (b.weightedLiabUsd ?? 0), 0)
  const totalWeightedAssets = balances.reduce((s, b) => s + (b.weightedAssetUsd ?? 0), 0)
  if (totalWeightedLiabs === 0) return []
  return balances
    .filter(b => b.assetQty > 0 && b.priceUsd > 0 && !STABLE.has(b.token) && b.assetUsd > 0.01)
    .map(b => {
      const weight = b.weightedAssetUsd / b.assetUsd
      const otherWeightedAssets = totalWeightedAssets - b.weightedAssetUsd
      const liqPrice = (totalWeightedLiabs - otherWeightedAssets) / (b.assetQty * weight)
      return { token: b.token, current: b.priceUsd, liq: liqPrice }
    })
    .filter(r => r.liq > 0 && r.liq < r.current)
}

export default function LiquidationCalc({ positions }) {
  const [drop, setDrop] = useState(0)
  const activePositions = (positions ?? []).filter(p => p.healthFactor !== null && p.borrowUsd > 0.01)
  if (!activePositions.length) return null
  const dropFraction = drop / 100

  return (
    <Card>
      <CardHeader>
        <span className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Liquidation Calculator</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">

        <div className="flex flex-col gap-4">
          {activePositions.map((pos, i) => {
            const prices = liquidationPrices(pos)
            const projHf = projectHf(pos, dropFraction)
            const buffer = pos.positionType === 'perp'
              ? pos.distancePct?.toFixed(1)
              : pos.healthFactor ? ((1 - 1 / pos.healthFactor) * 100).toFixed(1) : null
            const color = hfColor(projHf)
            const label = hfLabel(projHf)
            return (
              <div key={i} className="bg-muted rounded-sm p-4 flex flex-col gap-3 border border-border">
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize text-sm">{pos.protocol}</span>
                  {buffer && (
                    <span className="text-muted-foreground text-xs">
                      absorbs up to <span className="font-bold text-foreground">{buffer}%</span> drop
                    </span>
                  )}
                </div>
                {prices.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {prices.map(p => (
                      <div key={p.token} className="flex flex-col">
                        <span className="text-muted-foreground text-xs uppercase tracking-wider">{p.token} liq. price</span>
                        <span className="font-bold">${p.liq.toFixed(2)}</span>
                        <span className="text-muted-foreground text-xs">current ${p.current.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">Projected HF</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg" style={{ color }}>
                      {projHf !== null ? projHf.toFixed(3) : '∞'}
                    </span>
                    <Badge style={{ background: color + '20', color, border: 'none' }}>{label}</Badge>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Price drop stress test</span>
            <span className="font-bold text-sm">{drop === 0 ? 'Current' : `-${drop}%`}</span>
          </div>
          <Slider
            value={[drop]}
            onValueChange={([v]) => setDrop(v)}
            min={0} max={50} step={1}
          />
          <div className="flex justify-between text-muted-foreground text-xs">
            <span>0%</span><span>-10%</span><span>-20%</span><span>-30%</span><span>-40%</span><span>-50%</span>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
