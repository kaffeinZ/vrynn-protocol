export default function HealthGauge({ healthFactor }) {
  if (healthFactor === null) return (
    <span className="text-zinc-400 text-sm">No debt</span>
  )

  const hf = parseFloat(healthFactor)
  const color = hf >= 2.0 ? 'bg-green-500' : hf >= 1.5 ? 'bg-yellow-400' : 'bg-red-500'
  const width = Math.min(100, Math.max(0, (hf / 3.0) * 100)).toFixed(1)

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-zinc-400 mb-1">
        <span>Health Factor</span>
        <span className={hf < 1.5 ? 'text-red-400 font-bold' : 'text-white'}>{hf.toFixed(3)}</span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
