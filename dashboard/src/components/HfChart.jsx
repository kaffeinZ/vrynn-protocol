import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const API = 'https://vrynn.xyz/api'

const COLORS = {
  marginfi: '#00c8e0',
  kamino:   '#7000e0',
}

export default function HfChart({ walletAddress }) {
  const [data,    setData]    = useState({})
  const [period,  setPeriod]  = useState('24h')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!walletAddress) return
    setLoading(true)
    fetch(`${API}/hf-history/${walletAddress}?period=${period}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [walletAddress, period])

  const protocols = Object.keys(data)
  const allPoints = protocols.flatMap(p =>
    data[p].map(pt => ({ t: pt.t, [p]: parseFloat(pt.hf.toFixed(3)) }))
  )

  const merged = Object.values(
    allPoints.reduce((acc, pt) => {
      if (!acc[pt.t]) acc[pt.t] = { t: pt.t }
      Object.assign(acc[pt.t], pt)
      return acc
    }, {})
  ).sort((a, b) => a.t - b.t)

  const formatTime = (t) => {
    const d = new Date(t * 1000)
    return period === '24h'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-zinc-700 font-bold text-sm uppercase tracking-wider">Health Factor History</h2>
        <div className="flex gap-1">
          {['24h', '7d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                period === p ? 'bg-[#00c8e0] text-white' : 'text-zinc-400 hover:text-zinc-600'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-zinc-300 text-sm">Loading...</div>
      ) : merged.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-zinc-300 text-sm">No data yet — check back after a few minutes.</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={merged} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="t" tickFormatter={formatTime} tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(v, name) => [v.toFixed(3), name]}
              labelFormatter={formatTime}
              contentStyle={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine y={1.2} stroke="#e0007a" strokeDasharray="3 3" label={{ value: 'Liquidation', position: 'insideTopLeft', fontSize: 10, fill: '#e0007a' }} />
            <ReferenceLine y={1.5} stroke="#e06000" strokeDasharray="3 3" label={{ value: 'Warning', position: 'insideTopLeft', fontSize: 10, fill: '#e06000' }} />
            {protocols.map(p => (
              <Line key={p} type="monotone" dataKey={p} stroke={COLORS[p] ?? '#7000e0'} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {protocols.length > 1 && (
        <div className="flex gap-3">
          {protocols.map(p => (
            <div key={p} className="flex items-center gap-1">
              <div className="w-3 h-0.5 rounded" style={{ background: COLORS[p] ?? '#7000e0' }} />
              <span className="text-zinc-400 text-xs capitalize">{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
