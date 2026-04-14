import HealthGauge from './HealthGauge'

const RISK_COLORS = {
  SAFE:     'border-green-500/30 bg-green-500/5',
  WARNING:  'border-yellow-400/30 bg-yellow-400/5',
  HIGH:     'border-orange-500/30 bg-orange-500/5',
  CRITICAL: 'border-red-500/30 bg-red-500/5',
}

export default function PositionCard({ position }) {
  const { protocol, collateralUsd, borrowUsd, healthFactor, riskLevel, balances } = position
  const borderColor = RISK_COLORS[riskLevel] ?? 'border-zinc-700 bg-zinc-900'

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-4 ${borderColor}`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold capitalize text-lg">{protocol}</span>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          riskLevel === 'SAFE'     ? 'bg-green-500/20 text-green-400' :
          riskLevel === 'WARNING'  ? 'bg-yellow-400/20 text-yellow-300' :
          riskLevel === 'HIGH'     ? 'bg-orange-500/20 text-orange-400' :
          'bg-red-500/20 text-red-400'
        }`}>{riskLevel}</span>
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-black/30 rounded-lg p-3">
          <p className="text-zinc-400 text-xs mb-1">Collateral</p>
          <p className="text-white font-semibold">${collateralUsd?.toFixed(2) ?? '0.00'}</p>
        </div>
        <div className="bg-black/30 rounded-lg p-3">
          <p className="text-zinc-400 text-xs mb-1">Borrowed</p>
          <p className="text-white font-semibold">${borrowUsd?.toFixed(2) ?? '0.00'}</p>
        </div>
      </div>

      {/* Health gauge */}
      <HealthGauge healthFactor={healthFactor} />

    </div>
  )
}
