# Vrynn

Real-time liquidation risk monitor for Solana DeFi lending protocols.

DeFi lending is powerful but unforgiving — most platforms give you a health factor number and nothing else. No context, no alerts, no explanation of *why* your position is risky or what's driving the change. Vrynn was built to close that gap: continuous monitoring across MarginFi and Kamino, intelligent Telegram alerts before liquidation happens, and AI-powered analysis that accounts for your specific position type and current market conditions.

---

## Features

- **Multi-protocol monitoring** — tracks MarginFi and Kamino positions in a single dashboard
- **Position-type aware risk scoring** — LST loops, stablecoin loops, and volatile positions are scored differently (a jitoSOL/SOL loop at HF 1.3 is not the same risk as a SOL/USDC borrow at HF 1.3)
- **Health Factor history chart** — 24h and 7d HF trends per protocol
- **Telegram alerts** — fires on HIGH and CRITICAL risk, with smart deduplication to avoid spam
- **AI risk analysis** — Claude-powered analysis of your position, collateral composition, and price trends (4/day free)
- **Wallet-signature auth** — sign once, no passwords, no custodial risk
- **Price trend context** — Birdeye OHLCV data feeds the AI analysis with 24h price momentum

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard (React)                   │
│  Landing · ConnectWallet · Dashboard · HfChart          │
│  PositionCard · RiskScore · AiAnalysis · AlertHistory   │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS (vrynn.xyz/api)
┌────────────────────▼────────────────────────────────────┐
│                  Express API Server                     │
│  /portfolio  /positions  /analyze  /alerts              │
│  /settings   /telegram/link  /hf-history                │
│                                                         │
│  Monitor loop (node-cron, 60s)                          │
│    → MarginFi SDK  →  Kamino REST API                   │
│    → Birdeye OHLCV → Claude AI                          │
│    → Telegram Bot                                       │
│                                                         │
│  SQLite (vrynn.db)                                      │
│    users · wallets · positions · alerts · ai_usage      │
└─────────────────────────────────────────────────────────┘
```

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v4, Recharts |
| Wallet | `@solana/wallet-adapter-react`, WalletMultiButton |
| Backend | Node.js (ESM), Express 5 |
| Database | SQLite via `better-sqlite3` |
| Scheduling | `node-cron` |
| MarginFi | `@mrgnlabs/marginfi-client-v2` |
| Kamino | Kamino Lending REST API |
| Prices | Birdeye OHLCV API |
| AI | Anthropic Claude API |
| Alerts | Telegram Bot API |
| RPC | Helius (with batch-request serialisation for free tier) |

---

## Setup

### Prerequisites

- Node.js 20+
- A Helius RPC API key (free tier works)
- A Birdeye API key
- An Anthropic API key
- A Telegram bot token + chat ID (optional — alerts only)

### 1. Install dependencies

```bash
# Root (shared)
npm install

# Dashboard
cd dashboard && npm install
```

### 2. Configure the server

Copy `server/config.js` and fill in your keys — or set the following environment variables:

```
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
BIRDEYE_API_KEY=your_birdeye_key
ANTHROPIC_API_KEY=your_anthropic_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
MONITOR_INTERVAL_SECONDS=60
ADMIN_SECRET=your_admin_secret
```

### 3. Run in development

```bash
# Server (from repo root)
node server/index.js

# Dashboard (separate terminal)
cd dashboard && npm run dev
```

### 4. Build for production

```bash
cd dashboard && npm run build
# Serve dist/ behind Nginx or any static host
# Point /api/* to the Express server
```

---

## Risk Scoring

Health Factor tiers:

| HF | Risk Level |
|---|---|
| ≥ 2.0 | SAFE |
| 1.5 – 2.0 | WARNING |
| 1.2 – 1.5 | HIGH |
| < 1.2 | CRITICAL |

Position-type weights applied to the raw score:

| Position Type | Weight | Why |
|---|---|---|
| `lst_loop` | 0.2× | SOL/LST both move together — depeg risk only |
| `stablecoin_loop` | 0.15× | Interest-rate risk only, no price exposure |
| `volatile_collateral` | 1.0× | Full liquidation risk from collateral price drop |
| `volatile_borrow` | 1.0× | Full risk from borrowed token price pump |
| `mixed` | 1.0× | Both sides exposed |

---

## Telegram Alerts

Vrynn sends alerts when:
- Risk level is HIGH or CRITICAL
- Risk level changes in either direction
- Health Factor moves more than 0.05 within the same risk tier

To link your Telegram account to your wallet:
1. Click "Connect Telegram" in the dashboard
2. Start the bot and send the generated code

---

## AI Analysis

On-demand via the "Analyse Risk" button. The AI receives:
- All active positions with health factors and token balances
- Position type classification and risk context
- 24h price trends for your collateral and borrow tokens (Birdeye OHLCV)

Free tier: 4 analyses per day per wallet. Resets at midnight UTC.

---

## Project Structure

```
vrynn-protocol/
├── server/
│   ├── index.js          # Express app entry point
│   ├── config.js         # Environment config
│   ├── db.js             # SQLite schema + queries
│   ├── monitor.js        # 60s polling loop
│   ├── ai.js             # Claude integration
│   ├── alerts.js         # Telegram alert dispatch
│   ├── birdeye.js        # Price trend data
│   ├── priceMonitor.js   # Builds price context for AI
│   ├── rpc.js            # Solana connection
│   ├── twitter.js        # Optional Twitter integration
│   ├── api/
│   │   ├── routes.js     # All API endpoints
│   │   └── auth.js       # Wallet signature verification
│   └── protocols/
│       ├── marginfi.js   # MarginFi SDK integration
│       └── kamino.js     # Kamino REST API integration
├── dashboard/
│   └── src/
│       ├── pages/
│       │   ├── Landing.jsx
│       │   └── Dashboard.jsx
│       ├── components/
│       │   ├── PositionCard.jsx
│       │   ├── RiskScore.jsx
│       │   ├── HealthGauge.jsx
│       │   ├── AiAnalysis.jsx
│       │   ├── HfChart.jsx
│       │   ├── AlertHistory.jsx
│       │   ├── Settings.jsx
│       │   ├── TelegramLink.jsx
│       │   └── ConnectWallet.jsx
│       └── hooks/
│           └── useVrynn.js
└── landing/              # Static marketing page (optional)
```

---

## License

MIT