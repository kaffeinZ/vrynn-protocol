import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ConnectWallet from '../components/ConnectWallet'

const STEPS = [
  { n: '1', title: 'Connect your wallet', desc: 'Sign a message to verify ownership — no private keys ever leave your device.' },
  { n: '2', title: 'We monitor your positions', desc: 'MarginFi and Kamino positions scanned every 60 seconds, 24/7.' },
  { n: '3', title: 'Get alerted before liquidation', desc: 'Instant Telegram alerts when your health factor drops into danger.' },
]

const FEATURES = [
  { icon: '🤖', title: 'AI Risk Analysis', desc: 'DeepSeek analyses your positions and explains your risk in plain English.' },
  { icon: '⚡', title: 'Real-Time Monitoring', desc: 'Health factors tracked every 60 seconds across all your lending positions.' },
  { icon: '📡', title: 'Telegram Alerts', desc: 'Instant notifications sent directly to your Telegram when risk level changes.' },
  { icon: '🔗', title: 'Multi-Protocol', desc: 'MarginFi and Kamino supported today. More protocols coming soon.' },
]

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    features: ['1 wallet monitored', 'Telegram alerts', 'MarginFi + Kamino', '60s polling interval', 'AI risk analysis'],
    cta: 'Get Started',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$9',
    period: 'per month',
    features: ['Unlimited wallets', 'Priority alerts', 'All protocols', '15s polling interval', 'Advanced AI analysis'],
    cta: 'Coming Soon',
    highlight: true,
  },
]

export default function Landing() {
  const { connected } = useWallet()
  const navigate = useNavigate()

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
    <div className="min-h-screen bg-black text-white">

      {/* Nav */}
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
        <span className="text-xl font-bold">Vrynn</span>
        <ConnectWallet onAuth={handleAuth} compact />
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 flex flex-col items-center text-center gap-6">
        <div className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Solana DeFi Protection</div>
        <h1 className="text-5xl sm:text-6xl font-bold leading-tight">
          Never get liquidated<br />on Solana.
        </h1>
        <p className="text-zinc-400 text-lg max-w-xl">
          Vrynn monitors your lending positions on MarginFi and Kamino and sends you a Telegram alert before your health factor hits zero.
        </p>
        <ConnectWallet onAuth={handleAuth} />
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map(s => (
            <div key={s.n} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-white text-black text-sm font-bold flex items-center justify-center">{s.n}</div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-zinc-400 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center mb-10">Everything you need</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex gap-4">
              <span className="text-2xl">{f.icon}</span>
              <div>
                <h3 className="font-semibold mb-1">{f.title}</h3>
                <p className="text-zinc-400 text-sm">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center mb-10">Pricing</h2>
        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {PLANS.map(p => (
            <div key={p.name} className={`rounded-xl p-6 flex flex-col gap-4 border ${p.highlight ? 'border-white bg-zinc-900' : 'border-zinc-800 bg-zinc-900'}`}>
              <div>
                <div className="text-zinc-400 text-sm mb-1">{p.name}</div>
                <div className="text-3xl font-bold">{p.price} <span className="text-zinc-500 text-sm font-normal">/ {p.period}</span></div>
              </div>
              <ul className="flex flex-col gap-2">
                {p.features.map(f => (
                  <li key={f} className="text-zinc-300 text-sm flex items-center gap-2">
                    <span className="text-green-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <button
                disabled={p.cta === 'Coming Soon'}
                className={`mt-auto py-2 rounded-lg font-semibold text-sm transition-colors ${
                  p.cta === 'Coming Soon'
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-5xl mx-auto px-6 py-20 flex flex-col items-center text-center gap-6">
        <h2 className="text-3xl font-bold">Start monitoring for free</h2>
        <p className="text-zinc-400">Connect your wallet and get your first alert in under a minute.</p>
        <ConnectWallet onAuth={handleAuth} />
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-6 text-center text-zinc-600 text-sm flex flex-col gap-2">
        <p>© 2026 Vrynn Protocol · vrynn.xyz</p>
        <p className="text-zinc-300 text-xs max-w-xl mx-auto">
          Vrynn is in early beta. Alerts are informational only and do not constitute financial advice. 
          Always monitor your own positions. We are not responsible for any liquidations or losses.
        </p>
      </footer>

    </div>
  )
}
