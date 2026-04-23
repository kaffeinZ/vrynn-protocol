import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useVrynn } from '../hooks/useVrynn'
import PositionCard from '../components/PositionCard'
import RiskScore from '../components/RiskScore'
import AlertHistory from '../components/AlertHistory'
import Settings from '../components/Settings'
import TelegramLink from '../components/TelegramLink'
import AiAnalysis from '../components/AiAnalysis'
import HfChart from '../components/HfChart'

export default function Dashboard() {
  const { publicKey } = useWallet()
  const { portfolio, alerts, loading, error, lastUpdated, refresh } = useVrynn()

  const address = publicKey?.toBase58() ?? ''
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ''

  return (
    <div className="min-h-screen text-zinc-900 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-black/8 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-black gradient-text tracking-tight">Vrynn</h1>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#00c8e0]/15 text-[#00c8e0] border border-[#00c8e0]/30">Beta</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-400 text-sm font-mono">{short}</span>
          <WalletMultiButton />
        </div>
      </header>

      {/* Status bar */}
      <div className="bg-white border-b border-black/8 px-6 py-2 flex items-center justify-between text-xs text-zinc-400">
        <span>{loading ? 'Updating...' : lastUpdated ? `Updated ${lastUpdated}` : ''}</span>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-[#00c8e0] hover:text-[#00a8c0] disabled:opacity-40 transition-colors font-medium"
        >
          ↻ Refresh
        </button>
      </div>

      {error && <p className="text-[#e0007a] text-center font-medium px-6 py-2">{error}</p>}

      {/* 3-column layout */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr] gap-5 items-start">

        {/* Left — Alerts */}
        <aside className="flex flex-col gap-4 lg:order-1 order-2">
          <AlertHistory alerts={alerts} />
        </aside>

        {/* Centre — Positions */}
        <section className="flex flex-col gap-5 lg:order-2 order-1">
          {portfolio && (
            <>
              <RiskScore score={portfolio.riskScore} />

              <div className="grid grid-cols-2 gap-4">
                <div className="card p-4 glow-cyan border-l-4 border-l-[#00c8e0]">
                  <p className="text-zinc-400 text-xs mb-1 uppercase tracking-wider">Total Collateral</p>
                  <p className="text-zinc-900 text-2xl font-bold">${portfolio.totalCollateralUsd?.toFixed(2) ?? '0.00'}</p>
                </div>
                <div className="card p-4 glow-pink border-l-4 border-l-[#e0007a]">
                  <p className="text-zinc-400 text-xs mb-1 uppercase tracking-wider">Total Borrowed</p>
                  <p className="text-zinc-900 text-2xl font-bold">${portfolio.totalBorrowUsd?.toFixed(2) ?? '0.00'}</p>
                </div>
              </div>

              <AiAnalysis analyses={portfolio.latestAiAnalysis ?? []} onResult={refresh} />
              <HfChart walletAddress={address} />
              
              {portfolio.positions.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <p className="text-zinc-400">No active lending positions found.</p>
                  <p className="text-zinc-300 text-sm">Make sure your wallet has open positions on MarginFi or Kamino.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-xs">Active Positions</h2>
                  {portfolio.positions.map((p, i) => (
                    <PositionCard key={i} position={p} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Right — Settings */}
        <aside className="flex flex-col gap-4 lg:order-3 order-3">
          {portfolio && (
            <>
              <Settings settings={portfolio.settings} onSaved={(s) => console.log('settings saved', s)} />
              <TelegramLink />
            </>
          )}
        </aside>

      </main>
    </div>
  )
}