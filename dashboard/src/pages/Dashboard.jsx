import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useCheetah } from '../hooks/useCheetah'
import PositionCard from '../components/PositionCard'
import RiskScore from '../components/RiskScore'
import AlertHistory from '../components/AlertHistory'
import Settings from '../components/Settings'
import TelegramLink from '../components/TelegramLink'

const TABS = ['Positions', 'Alerts', 'Settings']

export default function Dashboard() {
  const { publicKey } = useWallet()
  const { portfolio, alerts, loading, error } = useCheetah()
  const [tab, setTab] = useState('Positions')

  const address = publicKey?.toBase58() ?? ''
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ''

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">CheetahFi 🐆</h1>
        <div className="flex items-center gap-4">
          <span className="text-zinc-400 text-sm font-mono">{short}</span>
          <WalletMultiButton />
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-zinc-800 px-6 flex gap-1">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="max-w-4xl w-full mx-auto px-6 py-8 flex flex-col gap-6 flex-1">

        {loading && <p className="text-zinc-400 text-center">Fetching positions...</p>}
        {error   && <p className="text-red-400 text-center">{error}</p>}

        {/* Positions tab */}
        {tab === 'Positions' && portfolio && (
          <>
            <RiskScore score={portfolio.riskScore} />

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

            {portfolio.latestAiAnalysis?.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-zinc-300 font-semibold">AI Risk Analysis</h2>
                {portfolio.latestAiAnalysis.map((a, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-xs capitalize">{a.protocol}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        a.risk_level === 'LOW'    ? 'bg-green-500/20 text-green-400' :
                        a.risk_level === 'MEDIUM' ? 'bg-yellow-400/20 text-yellow-300' :
                        a.risk_level === 'HIGH'   ? 'bg-orange-500/20 text-orange-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{a.risk_level}</span>
                    </div>
                    <p className="text-zinc-300 text-sm leading-relaxed">{a.analysis}</p>
                  </div>
                ))}
              </div>
            )}

            {portfolio.positions.length === 0 ? (
              <p className="text-zinc-400 text-center py-12">No active lending positions found.</p>
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

        {/* Alerts tab */}
        {tab === 'Alerts' && <AlertHistory alerts={alerts} />}

        {/* Settings tab */}
        {tab === 'Settings' && portfolio && (
          <div className="flex flex-col gap-6">
            <Settings
              settings={portfolio.settings}
              onSaved={(s) => console.log('settings saved', s)}
            />
            <TelegramLink />
          </div>
        )}

      </main>
    </div>
  )
}
