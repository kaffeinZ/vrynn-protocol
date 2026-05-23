import { getClient } from './marginfi.js';

const KAMINO_MARKETS = [
  { name: 'Main',     pubkey: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF', slug: 'main'     },
  { name: 'JLP',      pubkey: 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek', slug: 'jlp'      },
  { name: 'Altcoins', pubkey: 'ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5', slug: 'altcoins' },
]

let _cache   = null
let _cacheAt = 0
const TTL_MS = 5 * 60 * 1000

export async function getMarkets() {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache

  const [kamino, marginfi] = await Promise.allSettled([
    fetchKaminoMarkets(),
    fetchMarginFiMarkets(),
  ])

  const pools = [
    ...(kamino.status   === 'fulfilled' ? kamino.value   : []),
    ...(marginfi.status === 'fulfilled' ? marginfi.value : []),
  ]

  const filtered = pools
    .filter(p => p.supplyApy >= 0.1 && !(p.tvlUsd === null && p.supplyApy > 200))
    .sort((a, b) => b.supplyApy - a.supplyApy)
    .slice(0, 50)

  _cache   = filtered
  _cacheAt = Date.now()
  return filtered
}

async function fetchKaminoMarkets() {
  const pools = []

  await Promise.all(KAMINO_MARKETS.map(async (market) => {
    try {
      const res  = await fetch(`https://api.kamino.finance/kamino-market/${market.pubkey}/reserves/metrics`)
      const data = await res.json()

      for (const r of data) {
        if (r.maxLtv === '0') continue                        // deprecated / delisted pool
        const supplyApy  = parseFloat(r.supplyApy) || 0
        const borrowApy  = parseFloat(r.borrowApy) || 0
        const tvlUsd     = parseFloat(r.totalSupplyUsd) || 0
        const borrowedUsd = parseFloat(r.totalBorrowUsd) || 0
        if (tvlUsd < 10_000) continue

        pools.push({
          token:       r.liquidityToken,
          protocol:    'kamino',
          market:      market.name,
          supplyApy:   supplyApy * 100,
          borrowApy:   borrowApy * 100,
          tvlUsd,
          utilization: tvlUsd > 0 ? Math.round(borrowedUsd / tvlUsd * 100) : null,
          url:         `https://kamino.com/earn/lend`,
        })
      }
    } catch { /* skip failed market */ }
  }))

  return pools
}

async function fetchMarginFiMarkets() {
  const pools = []
  try {
    const client = await getClient()

    for (const [, bank] of client.banks) {
      try {
        const rates     = bank.computeInterestRates()
        const symbol    = bank.tokenSymbol
        if (!symbol) continue
        const rawSupply = rates.lendingRate?.toNumber?.()   ?? parseFloat(rates.lendingRate)   ?? 0
        const rawBorrow = rates.borrowingRate?.toNumber?.() ?? parseFloat(rates.borrowingRate) ?? 0
        const supplyApy = (Math.exp(rawSupply) - 1) * 100
        const borrowApy = (Math.exp(rawBorrow) - 1) * 100
        if (supplyApy < 0.01) continue

        pools.push({
          token:    symbol,
          protocol: 'marginfi',
          market:   'Main',
          supplyApy,
          borrowApy,
          tvlUsd:   null,
          url: `https://app.marginfi.com`,
        })
      } catch { /* skip broken bank */ }
    }
  } catch { /* MarginFi SDK unavailable */ }

  return pools
}
