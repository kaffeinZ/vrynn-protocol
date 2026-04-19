import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'

const API = 'https://vrynn.xyz/api'

export default function TelegramLink() {
  const { publicKey, signMessage } = useWallet()
  const [code,    setCode]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [copied,  setCopied]  = useState(false)

  async function handleGenerate() {
    if (!publicKey || !signMessage) return
    setLoading(true)
    setError(null)
    setCode(null)
    try {
      const { message } = await fetch(`${API}/auth/message`).then(r => r.json())
      const signature   = bs58.encode(await signMessage(new TextEncoder().encode(message)))

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
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-zinc-300 font-semibold">Link Telegram</h2>
        <p className="text-zinc-500 text-sm">
          Connect your Telegram to receive alerts directly in your chat.
        </p>
      </div>

      {!code ? (
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          {loading ? 'Generating...' : 'Generate Link Code'}
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-zinc-400 text-sm">
            Send this command to <span className="text-white font-mono">@VrynnBot</span> on Telegram:
          </p>
          <div className="flex items-center gap-2 bg-black rounded-lg px-4 py-3">
            <span className="text-white font-mono text-lg tracking-widest flex-1">
              /link {code}
            </span>
            <button
              onClick={handleCopy}
              className="text-zinc-400 hover:text-white text-xs transition-colors"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-zinc-500 text-xs">Code expires in 10 minutes.</p>
          <button
            onClick={handleGenerate}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            Generate new code
          </button>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  )
}
