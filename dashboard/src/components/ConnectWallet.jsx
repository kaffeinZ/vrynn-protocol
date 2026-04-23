import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useEffect, useState } from 'react'
import bs58 from 'bs58'

const API = 'https://vrynn.xyz/api'
let _authenticating = false

export default function ConnectWallet({ onAuth, compact }) {
  const { publicKey, signMessage, connected } = useWallet()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!connected || !publicKey || !signMessage) return
    if (localStorage.getItem('vrynn_auth')) return
    if (_authenticating) return
    _authenticating = true

    async function authenticate() {
      try {
        const { message } = await fetch(`${API}/auth/message`).then(r => r.json())
        const encoded   = new TextEncoder().encode(message)
        const signature = await signMessage(encoded)
        const sig58     = bs58.encode(signature)

        const res = await fetch(`${API}/wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: publicKey.toBase58(), signature: sig58 }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        onAuth?.({ address: publicKey.toBase58(), signature: sig58, ...data })
      } catch (err) {
        setError(err.message)
      } finally {
        _authenticating = false
      }
    }

    authenticate()
  }, [connected, publicKey])

  if (error) return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-red-400 text-sm">{error}</p>
      <WalletMultiButton />
    </div>
  )

  return <WalletMultiButton style={compact ? { fontSize: '13px', padding: '6px 14px', height: 'auto' } : {}} />
}