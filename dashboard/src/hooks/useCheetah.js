import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

const API = 'http://localhost:3001/api'

export function useCheetah() {
  const { publicKey } = useWallet()
  const [portfolio, setPortfolio] = useState(null)
  const [alerts, setAlerts]       = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (!publicKey) return

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const address = publicKey.toBase58()
        const [portfolioRes, alertsRes] = await Promise.all([
          fetch(`${API}/portfolio/${address}`),
          fetch(`${API}/alerts/${address}?limit=10`),
        ])
        const portfolioData = await portfolioRes.json()
        const alertsData    = await alertsRes.json()
        if (!portfolioRes.ok) throw new Error(portfolioData.error)
        setPortfolio(portfolioData)
        setAlerts(alertsData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [publicKey])

  return { portfolio, alerts, loading, error }
}
