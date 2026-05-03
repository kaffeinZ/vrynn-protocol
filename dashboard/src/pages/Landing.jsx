import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ConnectWallet from '../components/ConnectWallet'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const STEPS = [
  { n: '1', color: '#00c8e0', title: 'Connect your wallet', desc: 'Sign a message to verify ownership — no private keys ever leave your device.' },
  { n: '2', color: '#7000e0', title: 'We monitor your positions', desc: 'MarginFi, Kamino and Jupiter Perps monitored 24/7 — lending health factors and perp liquidation distances in one place.' },
  { n: '3', color: '#e0007a', title: 'Get alerted before liquidation', desc: 'Instant Telegram alerts when your health factor drops into danger.' },
]

const FEATURES = [
  { icon: '🤖', color: '#7000e0', title: 'AI Risk Analysis',      desc: 'DeepSeek analyses your positions and explains your risk in plain English.' },
  { icon: '⚡', color: '#00c8e0', title: 'Real-Time Monitoring',   desc: 'Health factors and perp liquidation distances tracked every 60 seconds across all your positions.' },
  { icon: '📡', color: '#e0007a', title: 'Telegram Alerts',        desc: 'Instant notifications sent directly to your Telegram when risk level changes.' },
  { icon: '📈', color: '#7000e0', title: 'Perps Monitoring',       desc: 'Track your Jupiter leverage positions with real-time liquidation distance alerts and PnL.' },
  { icon: '🔗', color: '#e06000', title: 'Multi-Protocol',         desc: 'MarginFi, Kamino and Jupiter Perps supported today. More protocols coming soon.' },
]

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    color: '#00c8e0',
    features: ['1 wallet monitored', 'Telegram alerts', 'MarginFi + Kamino + Jupiter Perps', '60s polling interval', '4 AI analyses per day'],
    cta: 'Get Started',
    highlight: false,
  },
  {
    name: 'Plus',
    price: null,
    color: '#7000e0',
    features: ['3 wallets monitored', 'All Free features', '30s polling interval', '10 AI analyses per day', 'More protocols'],
    cta: 'Coming Soon',
    highlight: true,
  },
  {
    name: 'Pro',
    price: null,
    color: '#e0007a',
    features: ['Unlimited wallets', 'All Plus features', '15s polling interval', 'Unlimited AI analyses', 'Priority alerts'],
    cta: 'Coming Soon',
    highlight: false,
  },
]

export default function Landing() {
  const { connected } = useWallet()
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()

  function handleAuth(authData) {
    localStorage.setItem('vrynn_auth', JSON.stringify(authData))
    navigate('/dashboard')
  }

  useEffect(() => {
    if (connected && localStorage.getItem('vrynn_auth')) {
      navigate('/dashboard')
    }
  }, [connected])

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Beta disclaimer */}
      <div className="sticky top-0 z-50 bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-700">
        Vrynn is in beta. Do not rely solely on this service for liquidation alerts — always monitor your positions independently.
      </div>

      {/* Nav */}
      <nav className="border-b border-border bg-card px-6 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-black gradient-text">Vrynn</span>
          <Badge variant="outline" style={{ color: '#00c8e0', borderColor: '#00c8e0' }}>Beta</Badge>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle dark={dark} toggle={toggle} />
          <ConnectWallet onAuth={handleAuth} compact />
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center gap-6">
        <Badge variant="outline" style={{ color: '#00c8e0', borderColor: '#00c8e040' }} className="uppercase tracking-widest text-xs px-4 py-1.5">
          Solana DeFi Protection
        </Badge>
        <h1 className="text-5xl sm:text-6xl font-black leading-tight">
          Master Your Solana <span className="gradient-text">Leverage Risk.</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl">
          Vrynn delivers real-time liquidation alerts across MarginFi, Kamino and Jupiter Perps — liquidation-proof your positions before volatility strikes.
        </p>
        <ConnectWallet onAuth={handleAuth} />
      </section>

      <Separator />

      {/* How it works */}
      <section className="py-20 bg-muted/40">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-12">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map(s => (
              <Card key={s.n} style={{ borderTop: `4px solid ${s.color}` }}>
                <CardContent className="flex flex-col gap-3 pt-5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-black" style={{ background: s.color }}>
                    {s.n}
                  </div>
                  <h3 className="font-bold">{s.title}</h3>
                  <p className="text-muted-foreground text-sm">{s.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-black text-center mb-12">Everything you need</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <Card key={f.title} style={{ borderLeft: `4px solid ${f.color}` }}>
              <CardContent className="flex gap-4 pt-5">
                <span className="text-3xl">{f.icon}</span>
                <div>
                  <h3 className="font-bold mb-1">{f.title}</h3>
                  <p className="text-muted-foreground text-sm">{f.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* Pricing */}
      <section className="py-20 bg-muted/40">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-black text-center mb-12">Pricing</h2>
          <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {PLANS.map(p => (
              <Card key={p.name} className={`relative flex flex-col ${p.highlight ? 'ring-2' : ''}`}
                style={{ borderTop: `4px solid ${p.color}`, ...(p.highlight ? { ringColor: p.color } : {}) }}>
                {p.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge style={{ background: p.color, color: 'white', border: 'none' }}>Most Popular</Badge>
                  </div>
                )}
                <CardContent className="flex flex-col gap-4 flex-1 pt-5">
                  <div>
                    <p className="text-muted-foreground text-sm mb-1 font-medium">{p.name}</p>
                    {p.price ? (
                      <div className="text-4xl font-black">
                        {p.price} <span className="text-muted-foreground text-sm font-normal">/ forever</span>
                      </div>
                    ) : (
                      <div className="text-2xl font-black" style={{ color: p.color }}>Coming Soon</div>
                    )}
                  </div>
                  <ul className="flex flex-col gap-2 flex-1">
                    {p.features.map(f => (
                      <li key={f} className="text-muted-foreground text-sm flex items-center gap-2">
                        <span className="font-bold" style={{ color: p.color }}>✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  {p.cta === 'Get Started' ? (
                    <ConnectWallet onAuth={handleAuth} compact />
                  ) : (
                    <Button disabled variant="secondary" className="w-full mt-auto">{p.cta}</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* Bottom CTA */}
      <section className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center gap-6">
        <h2 className="text-4xl font-black">Start monitoring <span className="gradient-text">for free</span></h2>
        <p className="text-muted-foreground text-lg">Connect your wallet and get your first alert in under a minute.</p>
        <ConnectWallet onAuth={handleAuth} />
      </section>

      {/* Footer */}
      <Separator />
      <footer className="px-6 py-6 flex flex-col items-center gap-2">
        <p className="text-muted-foreground text-sm">© 2026 Vrynn Protocol · vrynn.xyz</p>
        <p className="text-muted-foreground text-xs max-w-xl text-center">
          Vrynn is in early beta. Alerts are informational only and do not constitute financial advice.
          Always monitor your own positions. We are not responsible for any liquidations or losses.
        </p>
      </footer>

    </div>
  )
}