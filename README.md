# Vrynn

Solana DeFi portfolio dashboard — live positions, health factors, and risk across lending and perp protocols in one place.

Vrynn is in active development and the product is still taking shape. Features, APIs, and interfaces may change without notice.

---

## Status & Roadmap

> Living doc — flip the status marks and append to the log/ledger below.
> Editing this file is documentation only; it cannot affect the running server.

**What Vrynn is (as of 2026-07-20):** a public crypto market-intelligence site.
The core product is a daily, data-backed market brief — *what moved and what
coincided with it* — written to a professional, honestly-caveated standard:
facts and flagged correlations only, never advice or "what to do". A wallet-gated
personal layer (portfolio view) is a later add-on.

**Pivoted from:** a personal Solana lending-risk monitor (connect wallet →
health factors on MarginFi/Kamino/perps). That code still runs and stays as the
account layer, but it is no longer the product.

### Architecture (two layers)
- **Public layer** (anonymous, no wallet) — the daily brief + glance tiles,
  server-rendered so Google can index them. **This is V1.**
- **Personal layer** (wallet-gated) — portfolio view + future add-ons. The wallet
  connect is the login/account layer, kept from day one so personal features have
  something to attach to.

### Guardrails (do not break these)
- **Honesty bar:** every claim is a fact or a flagged correlation — never a guess
  dressed as insight, never buy/sell. Say "no clear catalyst" when there isn't one.
  Keeps us on the information side of the FCA line.
- **Don't break what runs:** the Express + SQLite + Claude server behind
  pm2/Cloudflare stays up; new surfaces are built alongside, never bolted onto a
  working path.
- **Cleanup protocol:** every step leaves nothing dead behind — removed code,
  files, deps, DB tables and storage are deleted *and recorded in the Cleanup
  Ledger*. No orphans, no "temporarily commented out".

### Status: ✅ done · 🔨 in progress · ⏳ next · 💤 parked · 🗑️ removed

- ✅ **P0 — Baseline back up.** Server rebuilt (better-sqlite3 for Node 24), live on :3001 behind Cloudflare.
- ⏳ **P1 — One brief page (keystone).** Server-render `/brief/today` from free live signals (CoinGecko `/global`, BTC/ETH/SOL, Fear & Greed) → Claude synthesis (honesty bar) → real HTML. Proves SSR + synthesis + honesty.
- ⏳ **P2 — Prove indexing.** Google Search Console; submit the brief page; confirm it indexes before scaling.
- ⏳ **P3 — Glance + archive.** Six tiles + every day's brief saved as a permanent indexable page.
- ⏳ **P4 — Signal depth.** Macro-calendar JSON (known dates), whale flows, unlocks, funding; liquidations once a source is chosen.
- 💤 **P5 — Personal layer.** Portfolio view = new wallet-holdings fetch (Helius DAS + existing price feeds); current risk code demoted to a panel or retired.
- 💤 **P6 — Premium tier.** Personalized/deeper brief + archive — the revenue surface the free brief funnels into.

### Cleanup Ledger
_Record every removal here so nothing is silently orphaned._
- _(nothing removed yet — all current code still runs)_

### Daily Log
- **2026-07-20** — Restored server after Node-24 / better-sqlite3 ABI break (~4h20m outage). Agreed pivot to a public daily market brief; wallet kept as account layer; roadmap added.

---

## What it does

Most DeFi dashboards give you a number and nothing else. Vrynn pulls your active positions across MarginFi, Kamino, and Jupiter/Drift perps, classifies the risk based on your actual position type, and lets you run an AI analysis that explains *why* your position sits at that risk level — factoring in collateral composition, borrow structure, and price trends.

No alerts. No monitoring. Connect your wallet, see the full picture, run an analysis if you want context.

---

## Features

- **Multi-protocol positions** — MarginFi and Kamino lending + Jupiter/Drift perp positions in a single view
- **Position-type aware risk scoring** — LST loops, stablecoin loops, and volatile positions scored differently (a jitoSOL/SOL loop at HF 1.3 is not the same risk as a SOL/USDC borrow at HF 1.3)
- **Perp liquidation distance** — shows distance to liquidation and leverage for open perp positions
- **Configurable thresholds** — set your own warning and critical levels for lending HF and perp liquidation distance; dashboard colours update accordingly
- **AI risk analysis** — Claude-powered analysis of your position, collateral composition, and price trends (4/day free)
- **AI analysis history** — all past analyses stored and browsable per wallet
- **Health Factor history chart** — 24h and 7d HF trends per protocol
- **Wallet-signature auth** — sign once, no passwords, no custodial risk

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Dashboard (React)                   │
│  Landing · ConnectWallet · Portfolio · Markets          │
│  PositionCard · PerpPositionCard · RiskScore            │
│  AiAnalysis · AI History · Settings                     │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS (/api)
┌────────────────────▼────────────────────────────────────┐
│                  Express API Server                     │
│  /portfolio  /positions  /analyze  /alerts              │
│  /settings   /hf-history  /markets                      │
│                                                         │
│  MarginFi SDK  →  Kamino REST API                       │
│  Jupiter Perps REST API                                 │
│  Birdeye OHLCV → Claude AI                              │
│                                                         │
│  SQLite (vrynn.db)                                      │
│    users · wallets · positions · ai_analyses            │
│    wallet_settings · ai_usage                           │
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
| MarginFi | `@mrgnlabs/marginfi-client-v2` |
| Kamino | Kamino Lending REST API |
| Jupiter Perps | Jupiter Perpetuals REST API |
| Prices | Birdeye OHLCV API |
| AI | Anthropic Claude API |
| RPC | Helius (with batch-request serialisation for free tier) |

---

## Setup

### Prerequisites

- Node.js 20+
- A Helius RPC API key (free tier works)
- A Birdeye API key
- An Anthropic API key

### 1. Install dependencies

```bash
# Server
npm install

# Dashboard
cd dashboard && npm install
```

### 2. Configure the server

Set the following environment variables (or edit `server/config.js`):

```
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
BIRDEYE_API_KEY=your_birdeye_key
ANTHROPIC_API_KEY=your_anthropic_key
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
# Proxy /api/* to the Express server
```

---

## Risk Scoring

### Lending (Health Factor)

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

### Perps (Liquidation Distance)

Risk is shown as the percentage distance between current price and liquidation price. Thresholds are user-configurable in Settings.

Default thresholds: warning at 10%, critical at 5%.

---

## AI Analysis

On-demand via the "Analyse Risk" button. The AI receives:
- All active positions with health factors and token balances
- Position type classification and risk context
- 24h price trends for collateral and borrow tokens (Birdeye OHLCV)

Free tier: 4 analyses per day per wallet, resets at midnight UTC.
Past analyses are stored and viewable in the AI History tab.

---

## Project Structure

```
vrynn-protocol/
├── server/
│   ├── index.js          # Express app entry point
│   ├── config.js         # Environment config
│   ├── db.js             # SQLite schema + queries
│   ├── ai.js             # Claude integration
│   ├── birdeye.js        # Price trend data
│   ├── rpc.js            # Solana connection
│   ├── api/
│   │   ├── routes.js     # All API endpoints
│   │   └── auth.js       # Wallet signature verification
│   └── protocols/
│       ├── marginfi.js   # MarginFi SDK integration
│       ├── kamino.js     # Kamino REST API integration
│       ├── jupiter.js    # Jupiter Perps integration
│       └── markets.js    # Lending rate aggregator
├── dashboard/
│   └── src/
│       ├── pages/
│       │   ├── Landing.jsx
│       │   ├── Dashboard.jsx
│       │   └── views/
│       │       ├── PortfolioView.jsx
│       │       ├── MarketsView.jsx
│       │       ├── AlertsView.jsx   # AI analysis history
│       │       └── SettingsView.jsx
│       ├── components/
│       │   ├── PositionCard.jsx
│       │   ├── PerpPositionCard.jsx
│       │   ├── RiskScore.jsx
│       │   ├── HealthGauge.jsx
│       │   ├── AiAnalysis.jsx
│       │   ├── HfChart.jsx
│       │   ├── Settings.jsx
│       │   └── ConnectWallet.jsx
│       └── hooks/
│           └── useVrynn.js
```

---

## Roadmap

This is an early-stage project. Direction may shift as the product evolves.

| Status | Feature |
|---|---|
| ✅ | MarginFi lending positions |
| ✅ | Kamino lending positions |
| ✅ | Jupiter / Drift perp positions |
| ✅ | Position-type aware risk scoring |
| ✅ | AI risk analysis — 4/day free |
| ✅ | AI analysis history |
| ✅ | Health Factor history chart (24h / 7d) |
| ✅ | Configurable dashboard thresholds |
| ✅ | Liquidation price calculator + stress test slider |
| ✅ | Live token prices in position cards |
| 🔜 | Demo mode — explore without connecting a wallet |
| 🔜 | Additional protocol support |
| 🔜 | Design system unification — landing + dashboard (see below) |

---

## Design Roadmap — Option A (Shadcn/ui unification)

The landing page (`landing/index.html`) and the dashboard (`dashboard/`) currently have different visual styles — they look like separate products. The goal is to make both surfaces feel like one cohesive product.

**The plan:**

1. **Adopt Shadcn/ui as the single design system** — already partially in place (`dashboard/components.json` exists). Extend it with a shared colour palette, typography scale, and component set.

2. **Rebuild the landing page inside the dashboard React app** — move `landing/index.html` into `dashboard/src/pages/Landing.jsx` as a proper React route. The landing becomes the unauthenticated entry point of the same app, not a separate HTML file.

3. **Landing page sections to build in React:**
   - Hero — headline, "Connect Wallet" CTA, short value prop
   - What it does — 3-column feature cards (multi-protocol, AI analysis, position-aware risk)
   - How it works — 3 numbered steps (connect → view positions → run analysis)
   - Footer — links, disclaimer, GitHub

4. **Dashboard visual pass** — once Shadcn/ui is the system, tighten the dashboard: consistent card borders, spacing, and colour tokens across PositionCard, PerpPositionCard, RiskScore, and the sidebar.

**Why this over a Framer template:** A Framer template for the landing would create a visual mismatch the moment a user clicks "Connect Wallet" and hits the dashboard. Building the landing inside the same React app means one font, one colour system, one feel end-to-end.

**Estimated scope:** 1–2 days. The data layer (API, hooks, components) does not change — this is entirely a visual/layout rebuild.

---

## Disclaimer

Vrynn is an informational tool only. Nothing on this platform constitutes financial advice. Always do your own research before making any financial decisions.

---

## License

MIT