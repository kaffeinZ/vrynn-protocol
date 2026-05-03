import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useVrynn } from '../hooks/useVrynn'
import { useTheme } from '../hooks/useTheme'
import PositionCard from '../components/PositionCard'
import PerpPositionCard from '../components/PerpPositionCard'
import RiskScore from '../components/RiskScore'
import AlertHistory from '../components/AlertHistory'
import Settings from '../components/Settings'
import TelegramLink from '../components/TelegramLink'
import AiAnalysis from '../components/AiAnalysis'
import LiquidationCalc from '../components/LiquidationCalc'
import ThemeToggle from '../components/ThemeToggle'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export default function Dashboard() {
  const { publicKey } = useWallet()
  const { portfolio, alerts, loading, error, lastUpdated, refresh } = useVrynn()
  const { dark, toggle } = useTheme()

  const address = publicKey?.toBase58() ?? ''
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ''

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-black gradient-text tracking-tight">Vrynn</h1>
          <Badge variant="outline" style={{ color: '#00c8e0', borderColor: '#00c8e040' }}>Beta</Badge>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm font-mono">{short}</span>
          <ThemeToggle dark={dark} toggle={toggle} />
          <WalletMultiButton />
        </div>
      </header>

      {/* Status bar */}
      <div className="bg-card border-b border-border px-6 py-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{loading ? 'Updating...' : lastUpdated ? `Updated ${lastUpdated}` : ''}</span>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="text-xs h-auto py-0">
          ↻ Refresh
        </Button>
      </div>

      {error && <p className="text-destructive text-center font-medium px-6 py-2">{error}</p>}

      {/* 2-column layout */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-5 items-start">

        {/* Centre — Positions */}
        <section className="flex flex-col gap-5 lg:order-1 order-1">
          {portfolio && (
            <>
              <RiskScore score={portfolio.riskScore} />

              <div className="grid grid-cols-2 gap-4">
                <Card className="glow-cyan border-l-4" style={{ borderLeftColor: '#00c8e0' }}>
                  <CardContent className="pt-4">
                    <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Total Collateral</p>
                    <p className="text-2xl font-bold">${portfolio.totalCollateralUsd?.toFixed(2) ?? '0.00'}</p>
                  </CardContent>
                </Card>
                <Card className="glow-pink border-l-4" style={{ borderLeftColor: '#e0007a' }}>
                  <CardContent className="pt-4">
                    <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Total Borrowed</p>
                    <p className="text-2xl font-bold">${portfolio.totalBorrowUsd?.toFixed(2) ?? '0.00'}</p>
                  </CardContent>
                </Card>
              </div>

              <AiAnalysis analyses={portfolio.latestAiAnalysis ?? []} onResult={refresh} />

              {portfolio.positions.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <p className="text-muted-foreground">No active positions found.</p>
                  <p className="text-muted-foreground text-sm">Make sure your wallet has open positions on MarginFi, Kamino, or Jupiter.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <h2 className="text-muted-foreground font-semibold uppercase tracking-wider text-xs">Active Positions</h2>
                  {[...portfolio.positions].sort((a) => (a.positionType === 'perp' ? -1 : 1)).map((p, i) => (
                    p.positionType === 'perp'
                      ? <PerpPositionCard key={i} position={p} />
                      : <PositionCard key={i} position={p} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Right — Alerts + Calc + Settings */}
        <aside className="flex flex-col gap-4 lg:order-2 order-2">
          <AlertHistory alerts={alerts} />
          {portfolio && (
            <>
              <LiquidationCalc positions={portfolio.positions} />
              <Settings settings={portfolio.settings} onSaved={(s) => console.log('settings saved', s)} />
              <TelegramLink />
            </>
          )}
        </aside>

      </main>
    </div>
  )
}