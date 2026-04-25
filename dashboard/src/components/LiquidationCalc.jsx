import { useState } from 'react'

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
  if (hf >= 2.0)  return 'SAFE'
  if (hf >= 1.5)  return 'WARNING'
  if (hf >= 1.2)  return 'HIGH'
  return 'CRITICAL'
}

function projectHf(pos, dropFraction) {
  if (pos.healthFactor === null) return null
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
    <div className="card p-5 flex flex-col gap-5">
      <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-xs">Liquidation Calculator</h2>

      <div className="flex flex-col gap-4">
        {activePositions.map((pos, i) => {
          const prices = liquidationPrices(pos)
          const projHf = projectHf(pos, dropFraction)
          const buffer = pos.healthFactor ? ((1 - 1 / pos.healthFactor) * 100).toFixed(1) : null
          const color  = hfColor(projHf)
          const label  = hfLabel(projHf)
          return (
            <div key={i} className="bg-zinc-50 rounded-xl p-4 flex flex-col gap-3 border border-zinc-100">
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize text-zinc-800">{pos.protocol}</span>
                {buffer && (
                  <span className="text-xs text-zinc-500">
                    absorbs up to <span className="font-bold text-zinc-800">{buffer}%</span> drop
                  </span>
                )}
              </div>
              {prices.length > 0 && (
                <div className="flex flex-wrap gap-4">
                  {prices.map(p => (
                    <div key={p.token} className="flex flex-col">
                      <span className="text-zinc-400 text-xs uppercase tracking-wider">{p.token} liq. price</span>
                      <span className="text-zinc-900 font-bold">${p.liq.toFixed(2)}</span>
                      <span className="text-zinc-400 text-xs">current ${p.current.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-xs">Projected HF</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg" style={{ color }}>
                    {projHf !== null ? projHf.toFixed(3) : '∞'}
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color, background: color + '20' }}>
                    {label}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 text-xs font-medium">Price drop stress test</span>
          <span className="text-zinc-900 font-bold text-sm">{drop === 0 ? 'Current' : `-${drop}%`}</span>
        </div>
        <input
          type="range" min={0} max={50} step={1} value={drop}
          onChange={e => setDrop(Number(e.target.value))}
          className="w-full accent-[#8b00ff] cursor-pointer"
        />
        <div className="flex justify-between text-zinc-300 text-xs">
          <span>0%</span><span>-10%</span><span>-20%</span><span>-30%</span><span>-40%</span><span>-50%</span>
        </div>
      </div>
    </div>
  )
}
