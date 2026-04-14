const RISK_COLORS = {
  CRITICAL: 'text-red-400',
  HIGH:     'text-orange-400',
  WARNING:  'text-yellow-400',
  LOW:      'text-green-400',
}

export default function AlertHistory({ alerts }) {
  if (!alerts?.length) return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
      <h2 className="text-zinc-300 font-semibold mb-3">Recent Alerts</h2>
      <p className="text-zinc-500 text-sm">No alerts fired yet.</p>
    </div>
  )

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
      <h2 className="text-zinc-300 font-semibold mb-3">Recent Alerts</h2>
      <div className="flex flex-col gap-3">
        {alerts.map((a, i) => (
          <div key={i} className="border-b border-zinc-800 pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-white text-sm capitalize">{a.protocol}</span>
                <span className={`text-xs font-bold ${RISK_COLORS[a.risk_level]}`}>
                  {a.risk_level}
                </span>
              </div>
              <span className="text-zinc-500 text-xs">
                {new Date(a.sent_at * 1000).toLocaleString()}
              </span>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed">{a.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
