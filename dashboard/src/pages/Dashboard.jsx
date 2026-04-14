import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useCheetah } from '../hooks/useCheetah'
import PositionCard from '../components/PositionCard'
import RiskScore from '../components/RiskScore'
import AlertHistory from '../components/AlertHistory'

export default function Dashboard() {
  const { publicKey } = useWallet()
  const { portfolio, alerts, loading, error } = useCheetah()

  const address = publicKey?.toBase58() ?? ''
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ''

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">CheetahFi 🐆</h1>
        <div className="flex items-center gap-4">
          <span className="text-zinc-400 text-sm font-mono">{short}</span>
          <WalletMultiButton />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-8">

        {loading && (
          <p className="text-zinc-400 text-center">Fetching positions...</p>
        )}

        {error && (
          <p className="text-red-400 text-center">{error}</p>
        )}

        {portfolio && (
          <>
            {/* Risk score */}
            <RiskScore score={portfolio.riskScore} />

            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4">
                <p className="text-zinc-400 text-xs mb-1">Total Collateral</p>
                <p className="text-white text-2xl font-bold">
                  ${portfolio.totalCollateralUsd?.toFixed(2) ?? '0.00'}
                </p>
              </div>
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4">
                <p className="text-zinc-400 text-xs mb-1">Total Borrowed</p>
                <p className="text-white text-2xl font-bold">
                  ${portfolio.totalBorrowUsd?.toFixed(2) ?? '0.00'}
                </p>
              </div>
            </div>

            {/* AI Analysis */}
            {portfolio.latestAiAnalysis?.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-zinc-300 font-semibold">AI Risk Analysis</h2>
                {portfolio.latestAiAnalysis.map((a, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-xs capitalize">{a.protocol}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        a.risk_level === 'LOW'      ? 'bg-green-500/20 text-green-400' :
                        a.risk_level === 'MEDIUM'   ? 'bg-yellow-400/20 text-yellow-300' :
                        a.risk_level === 'HIGH'     ? 'bg-orange-500/20 text-orange-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{a.risk_level}</span>
                    </div>
                    <p className="text-zinc-300 text-sm leading-relaxed">{a.analysis}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Positions */}
            {portfolio.positions.length === 0 ? (
              <p className="text-zinc-400 text-center py-12">
                No active lending positions found.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <h2 className="text-zinc-300 font-semibold">Active Positions</h2>
                {portfolio.positions.map((p, i) => (
                  <PositionCard key={i} position={p} />
                ))}
              </div>
            )}
          </>
        )}
        
        {/* Alert history */}
        <AlertHistory alerts={alerts} />

      </main>
    </div>
  )
}
