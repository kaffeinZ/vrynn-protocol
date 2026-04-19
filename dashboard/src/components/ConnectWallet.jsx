import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useEffect, useState } from 'react'
import bs58 from 'bs58'

const API = 'https://vrynn.xyz/api'

export default function ConnectWallet({ onAuth, compact }) {
  const { publicKey, signMessage, connected, disconnecting } = useWallet()
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!connected || !publicKey || !signMessage) return

    async function authenticate() {
      try {
        // 1. fetch the message to sign
        const { message } = await fetch(`${API}/auth/message`).then(r => r.json())

        // 2. sign it with Phantom
        const encoded = new TextEncoder().encode(message)
        const signature = await signMessage(encoded)

        // 3. send address + signature to backend
        const res = await fetch(`${API}/wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: publicKey.toBase58(),
            signature: bs58.encode(signature),
          }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        // 4. pass auth result up to parent
        onAuth({ address: publicKey.toBase58(), ...data })
      } catch (err) {
        setError(err.message)
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
