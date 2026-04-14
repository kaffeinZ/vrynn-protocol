export default function RiskScore({ score }) {
  const color =
    score <= 20 ? 'text-green-400' :
    score <= 50 ? 'text-yellow-400' :
    score <= 75 ? 'text-orange-400' :
    'text-red-400'

  const label =
    score <= 20 ? 'Low Risk' :
    score <= 50 ? 'Moderate' :
    score <= 75 ? 'High Risk' :
    'Critical'

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col items-center gap-2">
      <p className="text-zinc-400 text-sm">Portfolio Risk Score</p>
      <p className={`text-6xl font-bold ${color}`}>{score}</p>
      <p className={`text-sm font-semibold ${color}`}>{label}</p>
      <p className="text-zinc-500 text-xs">0 = no risk · 100 = liquidation imminent</p>
    </div>
  )
}
