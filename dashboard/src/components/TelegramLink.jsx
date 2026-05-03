import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const API = 'https://vrynn.xyz/api'

export default function TelegramLink() {
  const { publicKey } = useWallet()
  const [code,    setCode]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [copied,  setCopied]  = useState(false)

  async function handleGenerate() {
    if (!publicKey) return
    setLoading(true)
    setError(null)
    setCode(null)
    try {
      const auth      = JSON.parse(localStorage.getItem('vrynn_auth') || '{}')
      const signature = auth.signature
      if (!signature) throw new Error('Session expired — please reconnect your wallet')
      const res  = await fetch(`${API}/telegram/link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: publicKey.toBase58(), signature }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCode(data.code)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(`/link ${code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold text-sm">Link Telegram</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">Connect your Telegram to receive alerts directly in your chat.</p>

        {!code ? (
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full text-white"
            style={{ background: 'linear-gradient(90deg, #00c8e0, #7000e0)' }}
          >
            {loading ? 'Generating...' : 'Generate Link Code'}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Send this command to <span className="font-mono font-bold text-foreground">@VrynnBot</span> on Telegram:
            </p>
            <div className="flex items-center gap-2 bg-muted border border-border rounded-sm px-4 py-3">
              <span className="font-mono text-lg tracking-widest flex-1">/link {code}</span>
              <button
                onClick={handleCopy}
                className="text-[#00c8e0] hover:text-[#00a8c0] text-xs font-semibold transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-muted-foreground text-xs">Code expires in 10 minutes.</p>
            <button
              onClick={handleGenerate}
              className="text-[#00c8e0] hover:text-[#00a8c0] text-sm font-medium transition-colors"
            >
              Generate new code
            </button>
          </div>
        )}

        {error && <p className="text-[#e0007a] text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}
