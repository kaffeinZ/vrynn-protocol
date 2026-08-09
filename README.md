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
- **Validate every aggregate against its own components before publishing.**
  Any number you did not compute yourself — a vendor's category total, a sector
  change, an index level — gets cross-checked against the parts it claims to
  summarise. Every data error this project has shipped or nearly shipped was
  caught by exactly this move, three times over: `liquid-staking-tokens` claiming
  a $26.9M cap against $34.1B of constituents (1268× wrong); `DFEDTARU` firing a
  "release" every day because a daily series always advances; `real-world-assets-rwa`
  publishing "−35%" that was CoinGecko dropping a constituent, not a market move.
  All three looked entirely plausible. **Any new data source meets this bar on
  arrival, not after it burns you.**
- **Verification scales with the size of the claim.** The corollary, and the
  harder half. "Reject anything unverifiable" is the obvious tightening and it is
  worse than the bug — one transient API failure took out 11 of 12 sector pages in
  testing, which is a bigger failure than one page occasionally being wrong.
  Bounded-downside claims may ship unverified with a warning; extraordinary ones
  may not. Tighten a guard against the failure you just saw and you will create a
  larger one you have not seen yet.

### Status: ✅ done · 🔨 in progress · ⏳ next · 💤 parked · 🗑️ removed

- ✅ **P0 — Baseline back up.** Server rebuilt (better-sqlite3 for Node 24), live on :3001 behind Cloudflare.
- ✅ **P1 — One brief page (keystone).** `server/brief.js` + route at `/brief/today`. Server-rendered HTML from CoinGecko `/global`, BTC/ETH/SOL, Fear & Greed → LLM synthesis (honesty bar) → real crawlable HTML. Verified: SSR ✅, synthesis ✅, honesty bar held on a no-catalyst day ("no clear catalyst is evident in today's inputs"). One model call per UTC day, cached in memory.
- 🔨 **P2 — Prove indexing.** `/sitemap.xml` live 2026-08-08 (18 URLs, all verified 200, `application/xml`, honest per-URL `lastmod` from `created_at` — dated briefs immutable so theirs never advance). Fixes a live defect: `robots.txt` had been advertising a sitemap that 404'd. Internal crawl path already complete (`/` → `/brief` → all 16 dated pages, plus 5 onward links per brief via the rail). **Next: submit the sitemap in Search Console, then read the coverage report over days-to-weeks — a new domain with no authority will not get 16 thin dated pages indexed quickly, so slow uptake is expected, not a fault.**
  _(earlier P2 work: `/brief/:date` permanent dated URLs saved to `daily_briefs`; `robots.txt` fixed; homepage serves today's brief, dashboard moved to `/app`; indexing requested 2026-07-24.)_
- ✅ **P3 — Glance + archive.** Archive index at `/brief` done. Six stat tiles on brief page done (market cap, BTC, ETH, SOL, dominance, Fear & Greed — in `renderBrief` since P1). `drivers` transparency layer deferred to P4 — depends on structured JSON output from the redesigned synthesis prompt.
- ✅ **P4 — Signal depth + synthesis redesign.**
  1. ✅ Validated synthesis prompt against live `market_state` — structured JSON output, 3-tier claim tagging, honesty bar confirmed.
  2. ✅ Wired Coinalyze (funding rates + open interest), FRED (CPI, Fed Funds, 10Y yield), ForexFactory (macro calendar), CoinTelegraph + Decrypt RSS (news). CryptoPanic dropped (free tier discontinued Apr 2026).
  3. ✅ Replaced ad-hoc prompting with `market_state` → structured synthesis: `drivers` array + `explained` field. Stored in DB. Drivers transparency section rendered on brief page.
  4. ✅ Open interest tile (BTC + ETH from Coinalyze — replaces liquidations, no free aggregate source exists). Macro today tile (ForexFactory). Whale flows + unlocks deferred.
- ✅ **P4.5 — Honesty hardening** (work order, 2026-08-08). News items now carry `published_utc`, stale >36h dropped, sorted newest-first — previously a 3-day-old headline could sit in today's `market_state` and be read as today's cause. Banned-phrase list extended (`on the back of`, `fuelled by`, `boosted by`, …) + verdict register banned (`bullish`/`bearish`/`oversold`…). Both worked examples added as few-shot. `btc_dominance_change_24h_pct` derived from yesterday's stored row. 30-day honesty track record rendered on the homepage. **06:00 UTC cron + boot catch-up** — auto-publish is real, so "published each morning" is now a true claim. Eval harness at `eval/run.js` with four fixtures mined from stored history.
- 💤 **P5 — Personal layer.** Portfolio view = new wallet-holdings fetch (Helius DAS + existing price feeds); current risk code demoted to a panel or retired.
- 💤 **P6 — Premium tier.** Personalized/deeper brief + archive — the revenue surface the free brief funnels into.

### Cleanup Ledger
_Record every removal here so nothing is silently orphaned._
- **2026-07-25** — Deleted 3 orphaned React components with zero importers: `dashboard/src/components/AlertHistory.jsx`, `MarketsPanel.jsx`, `TelegramLink.jsx`. Verified unreferenced by grep before removal; dashboard build re-run clean after. No deps, DB tables, or routes removed alongside — `useMarkets` still has other importers.
- **2026-07-26** — Deleted `dashboard/public/favicon-v2.svg`. Two favicons existed; `index.html` referenced v2 and `favicon.svg` was orphaned. New mark written to the canonical `favicon.svg`, all references repointed, v2 removed. Dashboard rebuilt (`dist/` no longer carries it) and `/favicon-v2.svg` confirmed 404.
- _Known follow-ups (not yet removed, still wired):_ the Telegram flow is disabled at `server/index.js` (`startBot()`/`startMonitor()` not called) but `telegram_link_codes` table + `createLinkCode`/`claimLinkCode` in `db.js` remain. Old protocol dashboard (`server/protocols/*`, `PositionCard`, `useVrynn`, etc.) is **live**, not dead — it is removed in P5 when the new portfolio view replaces it.

### Sector spike notifier + the RWA incident (2026-08-09)

**Built.** A notification, not a ranker — it fires only when a curated sector clears every bar and
is silent otherwise. Silence is the normal output: on a quiet day the brief renders exactly as if
the feature did not exist (no line, no empty block, no "nothing spiked today" — a slot that wants
filling is how bars get lowered). Admission tests, all in code before the model sees anything:
`|move| ≥ 8%`, divergence from the market `≥ 5pp`, cap `≥ $1B`, `≥ 8` constituents, and
cap-weighted constituent cross-validation within `12pp`. `sector_note` is an OPTIONAL synthesis
field, so its absence can never fail a run. Both paths verified end to end.

**Testing it found a false number already live on the site.** `/sector/rwa` was publishing
*"RWA sector plunges 35%"* while its own 50 constituents were cap-weighted at **−0.89%**. The
category cap had gone from $62.8B to $40.4B — CoinGecko dropping a constituent, i.e. a composition
change, not a market move. Page pulled immediately (the route now falls back to the previous valid
read).

**Root cause: `validateCategory` only ever checked the CAP, never the CHANGE.** RWA's cap was
consistent with its top-3, so it passed. Fixed — every sector is now cross-validated on its 24h
change at generation time via `validateChangeAgainstConstituents()`, not just spike candidates.
The comparison is **cap-weighted**, because the category figure is cap-weighted and an
equal-weighted mean would falsely reject legitimate moves carried by one large constituent.
Verified: RWA rejected (34pp gap), DeFi accepted (0.08pp), Gaming accepted (4.6pp — a real rally).

**Unverifiable ≠ broken — verification is required in proportion to the size of the claim.**
The first version of this fix rejected anything it could not verify, which meant a single transient
429 took out *every* sector page at once (observed: 11 of 12 rejected on `n/a` during testing —
a self-inflicted near-miss, caught before it ever ran on a cron). But blanket-accepting unverified
data is the hole RWA fell through. The split, since a composition-change artefact shows up as a
*large* spurious move: an unverifiable move under `UNVERIFIED_MOVE_CEILING` (5%) ships with a
warning — bounded downside — while an unverifiable move at or above it is rejected, because that is
precisely the case where verification mattered. Constituent calls are spaced 1.5s apart, since
twelve back-to-back is itself enough to trip the free tier.

**Test-time HTTP cache** (`server/httpCache.js`). Production burns ~12 CoinGecko calls a day and
sits well inside the free tier; what exhausts it is *iterating*. `VRYNN_HTTP_CACHE=1` replays
outbound API calls from `.http-cache/` (gitignored, 1h TTL default, failures cached too so a 429
replays instead of re-firing). **Off unless explicitly enabled** — a brief built from cached prices
would be silently stale. The OpenRouter call is deliberately never cached, so evals always exercise
a real generation.

**Cost:** ~12 extra CoinGecko calls per daily run, one per sector. Within the ~333/day free tier,
but the ceiling is now closer — a second daily run would not fit. Unverifiable (429, fetch failure)
is treated as *not publishable*, so rate-limit exhaustion degrades to silence rather than to a
guessed number.

### Deferred: daily sector mover (spec + measured guard thresholds)
Idea: a line in the daily brief — "biggest sector move today: X +12%, against a market up 0.5%" —
rather than a page per winner (a page per day per category is thin, duplicative, and drifts back
toward doorway pages). Costs one synthesis field and one template block; no new routes.

**The mechanism is structurally biased toward broken data.** A max-ranker selects for outliers, and
a bad aggregate produces a larger apparent move than any real one. Measured against the live
catalogue on 2026-08-08: the top ten movers among 359 usable categories were
`zodiac-themed +222%` ($1M cap), `remora-markets-tokenized-rstocks −100.00%` ($0M),
`pump-fun-creator +98%` ($2M) — **18 of the top 20 had sub-$200M caps, and only 1 of 20 survived a
$1B floor.** All passed the existing `validateCategory` guard, which was built to sanity-check a
curated list, not to rank a catalogue.

Required before this ships (the current guard alone is insufficient):
- existing guard (non-null cap + 24h change, cap ≥ top-3 sum), **plus**
- minimum cap floor — **$1B**, from the measurement above ($200M leaves 2/20, $1B leaves 1/20)
- minimum constituent count, so a three-token "ecosystem" cannot win
- cross-validate the winner against its own constituents at selection time: if the category claims
  +30% while its top coins average +4%, the aggregate is broken — skip it
- a floor on the move itself: if the day's biggest sector move is small, publish "no sector broke
  out today" rather than manufacturing a story. Same discipline as "no clear catalyst".

### Deferred: chain-ecosystem pages (Solana, BNB)
Re-checked live 2026-08-09: `solana-ecosystem` still returns null cap/change/volume with an empty
top-3 — unchanged, still blocked. `binance-smart-chain` is **also null**, so BNB would have failed
validation identically; the only Binance categories carrying data are launchpad/airdrop promos, not
a chain ecosystem. Broader: of 388 `*-ecosystem` categories only **48** carry both a cap and a 24h
change (88% unusable), so CoinGecko's chain-ecosystem aggregation is broken almost everywhere and
`base-native` working is the anomaly (note it is not named `*-ecosystem`).

Consequence: computing an aggregate from constituents is not a one-off patch for Solana — it is the
only viable path to *any* chain ecosystem page, which raises its value and confirms it is a real
build rather than a config line.

### Honesty debts paid (2026-08-09)
Three things the site was stating, or failing to state, that its own standard forbids.

1. **No as-of timestamp on any number.** Every tile was presented as if current while being a
   snapshot from generation time — a visitor at 22:00 UTC saw prices up to 20 hours stale with
   nothing indicating it. Every brief and sector page now carries a line under the tiles:
   _"Market data as of HH:MM UTC on <date> — captured once daily when the brief is written, and
   not updated afterwards."_ Sourced from the stored `as_of_utc`.
2. **"Published each morning at 06:00 UTC" was not true.** Lazy generation fires whenever the
   first visitor or crawler hits the page after midnight UTC — 2026-08-09's brief was written at
   02:14. The specific time is removed everywhere; "each morning" is accurate regardless of which
   path fires, and the as-of line now carries the precision.
3. **The subscribe form promised delivery "at 06:00 UTC"** with no sending pipeline behind it.
   Now "each morning" — a promise that can be kept once sending exists.

**Why the brief numbers stay frozen (do not "fix" this):** the tiles are the evidence the prose
reasons about. If they updated live while the text stayed fixed, a brief reading "the market fell
2.7% alongside a CPI print" would sit beside a tile reading +0.4% — self-contradicting, and on
dated archive pages simply wrong, since `/brief/2026-07-28` is a historical document. A live
price strip is a *separate* surface if ever wanted: visually distinct, clearly labelled, never
merged into the brief's frozen tiles.

### Visual pass (2026-08-08)
**Type split:** Newsreader (serif) for prose and headlines, IBM Plex Mono for every number and
label, with `tabular-nums` so counting figures don't shift the layout. The split is the point —
the reader distinguishes writing from data without being told, which mirrors the distinction the
product is built on. Drop cap on the first paragraph.

**Fonts are self-hosted** at `/fonts/*.woff2` (latin subset, 161KB total, `immutable`), not loaded
from Google's CDN. Two reasons: the CDN costs two render-blocking external requests on a site whose
strategy depends on being fast and crawlable, and it sends every visitor's IP to Google, which is a
live UK/EU data-protection exposure. Self-hosting is faster and removes it.

**Sparklines** (`<vr-spark>`, a dependency-free web component) on six tiles, fed from
`getSparkSeries()` — real trailing values out of `daily_briefs`, not decorative. Hides itself below
two data points, so it degrades cleanly on a new install.

**Motion:** count-up on entry and staggered reveal on scroll, via IntersectionObserver.
`prefers-reduced-motion` skips animation entirely (values render final, everything visible) rather
than merely shortening it, and there is a no-IntersectionObserver fallback that shows everything.

**Deliberately NOT taken — inline claim chips.** `synthesize` returns `drivers` as a separate array
and never marks which sentence maps to which driver. Tagging inline would need either fuzzy-matching
claims back to sentences (which will mis-tag — and a wrong "fact" chip on an honesty product attacks
the actual thesis) or changing the output contract, i.e. touching the prompt the eval suite is built
around. The classification is already rendered in "How we read this move". Placement question, not a
missing feature.

### Email capture (2026-08-08) — built to make the launch compound
Inline form at the foot of every brief and sector page, after the read rather than as a popup
before it. `POST /subscribe` (10/hour, stricter than `/api`), `GET /unsubscribe/:token`.
Works without JavaScript via a plain form POST; JS only upgrades it to submit in place.
**Unsubscribe token issued on the first row, not retrofitted** (UK data protection — cheap now,
painful later), and the copy states the address is used only for the brief and never shared.
Re-subscribing reuses the original token so old unsubscribe links never silently break.
Responses are identical whether or not the address was already known — no enumeration.

**No sending pipeline yet, deliberately.** This banks addresses so a launch that works does not
evaporate; sending gets built when there is a list worth sending to. `getSubscriberStats()`
reports total/active.

### Build 1 — Sector pages (2026-08-08)
Twelve curated sectors at `/sector/:slug` (+ dated archive at `/sector/:slug/:date`), generated
after the daily brief so they reuse the same `market_state` — one macro block, one source of truth.
Homepage links all twelve (the crawl path; the sitemap alone does not pass authority), and all
24 sector URLs are in the sitemap. Sitemap is now 42 URLs.

**Two categories were rejected before shipping, one of which would have published a false number:**
`solana-ecosystem` returns null for cap/change/volume; `liquid-staking-tokens` reports a $26.9M
aggregate while its own top-3 constituents sum to $34.1B — wrong by 1268×, and plausible-looking
enough that no reader would catch it. Only 359 of 749 CoinGecko categories carry both a cap and a
24h change, so curation is a data-quality necessity, not just an SEO guard.
_Solana is on the revisit list: it is the home audience, and the aggregate can be computed from
constituents if CoinGecko keeps returning null._

**Runtime guard** (`validateCategory`) re-checks every sector each run: null cap, null 24h change,
or an aggregate below its own top-3 all cause a skip plus a `notifyAdmin` alert. This is the main
protection, not the backstop — curation fixes what is known broken today, the guard catches what
breaks next month. Set `TELEGRAM_ADMIN_CHAT_ID` to route those alerts to Telegram (they go to the
error log until then; the previously-assumed Telegram wiring in the cron never existed).

### Honesty enforced in code, not just prompted (2026-08-08)
The banned-phrase rules now run inside `synthesize`, not only in the eval: a response containing a
causal phrase, a verdict term, or a fabricated consensus fails the attempt and retries. If every
attempt leaks, `synthesize` returns null and the page renders data without prose — publishing no
read beats publishing a causal claim the data does not support. The cron publishes unattended
daily, so the check has to run in production, not just in tests.

**Model choice is load-bearing.** `deepseek-v4-flash` is a *reasoning* model: on some inputs it
consumes the entire token budget thinking and emits nothing (verified at 8000 tokens, 0 emitted;
`reasoning:{exclude:true}` and `effort:'low'` are both ignored by the provider, so more budget
cannot fix it). Every "empty completion" and mid-JSON truncation seen during development traces to
this. It stays primary because it follows the honesty rules markedly better than the alternatives;
the fallback is `mistral-small-24b`, verified non-reasoning against the exact input that starves the
primary. **Do not set either model to a reasoning model** — `qwen3.7-flash` fails identically.

### Share metadata (2026-08-08)
Pages carried title/description/canonical but **no** Open Graph, Twitter Card or structured
data — so a link shared on X, Telegram, Discord or Slack rendered as a bare URL with no
preview, on the exact channel that would produce the first traffic. Added per-page OG +
Twitter tags and `NewsArticle` JSON-LD (`datePublished`, publisher, `isAccessibleForFree`).
Share cards are generated per brief at `/og/:date.png` — 1200×630, rendered from the stored
row so each card carries that day's real headline, market-cap move, BTC/ETH/SOL and the
`explained` badge. Cards are rasterised with `rsvg-convert` and cached to `og-cache/`;
immutable once published, so served `max-age=31536000`. **Runtime dependency:** `rsvg-convert`
(`librsvg2-bin`) must be installed, or the route returns 503 and previews fall back to no image.

### Host canonicalisation (2026-08-08)
`www.vrynn.xyz` and `vrynn.xyz` were both serving 200 with identical content while every
`<link rel="canonical">` declared apex — duplicate content splitting an already-tiny
authority signal across two hosts. Nginx now 301s www → apex with path and query preserved
(`return 301 https://vrynn.xyz$request_uri;`), and the apex block's `server_name` was
narrowed to `vrynn.xyz` alone. The redirect block matches `www.vrynn.xyz` **exactly** — a
broader `server_name` there would make apex 301 to itself and loop, so "apex still returns
200, not 301" is the pass/fail gate on any future change to this file.
Config backup: `/root/vrynn-nginx.bak.*`. **Search Console: submit the sitemap under the
apex property (`https://vrynn.xyz/`) — GSC treats www and apex as separate properties, and
the earlier www submission was doomed regardless because every URL in the sitemap is apex.**

### Known gaps
- **Macro actuals — RESOLVED 2026-08-08.** ForexFactory never populates `actual` (verified: 0 of 99 events), so it is now used for the forward schedule only. Completed releases come from **BLS v1** (keyless, 25 queries/day — CPI, core CPI, PPI, unemployment, payrolls, avg earnings) and **FRED** (PCE, core PCE, real GDP, Fed funds). `market_state.macro` is split into `scheduled` and `completed`; only `completed` carries numbers the model may cite. Release detection is period-advance against the `macro_state` table, not a guessed calendar. **Timing note:** the 06:00 UTC cron predates 13:30 UTC US releases, so today's print appears in tomorrow's brief by design — the brief reports completed releases plus today's schedule, which is how a morning note actually reads.
- **Consensus / forecast — DEFERRED.** Official sources publish what happened, not what was expected, so there is no "vs 3.1% expected" figure. Surprises are framed against the *previous* reading instead ("3.53%, down from 4.25% prior"), which stays on primary-source footing. The prompt explicitly forbids inventing a consensus, and `eval/snapshots/release.json` asserts against fabricated "vs expected" framing. Revisit via a ForexFactory scraper (fragile + ToS grey) or Trading Economics (verify US is on the free tier) only if it proves worth a paid tier.
- **Stored HTML goes stale on template changes.** Briefs persist finished HTML, so any render change needs a backfill re-render pass. Hit three times so far. Fix is to store data only and render per request.

### Daily Log
- **2026-07-20** — Restored server after Node-24 / better-sqlite3 ABI break (~4h20m outage). Agreed pivot to a public daily market brief; wallet kept as account layer; roadmap added.
- **2026-07-22** — AI model default → `deepseek/deepseek-v4-flash` (config.js:10, one swappable line). Built P1: `server/brief.js` + `/brief/today` route, server-rendered HTML, honesty prompt verified on a flat no-catalyst day. Existing dashboard/wallet/API untouched.
- **2026-07-24** — P2/P3 core: `daily_briefs` DB table added; briefs saved on generation and served by date at `/brief/:date`; `robots.txt` fixed (was serving SPA index.html via Cloudflare managed append); indexing request submitted to Google Search Console.
- **2026-07-25** — P2 follow-up: homepage (`/`) serves today's brief; dashboard moved to `/app`; archive at `/brief` done. P3 complete. P4 steps 1–3: synthesis prompt validated; Coinalyze (funding + OI), FRED (CPI/Fed Funds/10Y), ForexFactory, CoinTelegraph + Decrypt RSS wired into `market_state`; structured synthesis output (drivers + explained) live and stored in DB; drivers transparency section rendered on brief page. P4 closed with OI + macro tiles (8 total) and visitor-facing tag labels.
- **2026-08-08 (b)** — Macro actuals addendum. BLS v1 needs **no key** (the addendum assumed a v2 key for `calculations`), so YoY is computed from raw index values instead — validated exactly against FRED: BLS `CUUR0000SA0` → 3.53% vs FRED `CPIAUCNS` pc1 → 3.53%. Found the PPI series the addendum left blank (`WPUFD4`) and verified all ten IDs against live responses. Caught a bug the design didn't anticipate: `DFEDTARU` is a *daily* series, so period-advance detection would have reported a Fed funds "release" every single day — added `onChangeOnly` so it fires only when the rate actually moves. `macro_state` pre-seeded (10 series) so day one reports nothing stale. New eval fixture `release.json` asserts the model cites the actual and never fabricates "vs expected"; suite is 5/5 green.
- **2026-08-08** — Applied the 7-point honesty work order. Corrected four inferred identifiers before applying: project is ESM not CommonJS (`require` → `import`), table is `daily_briefs` not `briefs`, synthesis export is `synthesize` not `generateBrief`, and `decodeEntities` did not exist (extracted from the old inline replace chain). Eval fixtures mined from 15 stored rows: quiet=08-02, macro=07-30, crash=07-28, rally=07-31; `published_utc` backfilled into fixture news to match the new contract. Suite green — quiet fixture still returns `unexplained` with all-`unknown` drivers after every prompt edit, and no banned/verdict term appears in any of the four. One assertion corrected: "macro day must not be unexplained" was wrong, because scheduled-but-unreleased events genuinely cannot explain a move that already happened. All 15 P4-shaped rows re-rendered to pick up the template.
- **2026-07-26** — Landing pass. Hero block added above the brief (states what Vrynn is + teaches the Fact/Timing/No driver vocabulary before the tags appear below). Layout widened to 1100px: tiles full width at an explicit 2→4 column grid (`auto-fit` was leaving an orphan 8th tile), prose capped at 700px beside a new right rail holding "How we read this move" + recent briefs. Archive aligned to the same container, hero and type scale; entries now a 2-up grid with an explained badge. **Bug fixed:** archive snippets were split on `/[.!?]/`, so every summary truncated at the first decimal ("market cap rose 0."). Now stores the synthesis `headline` (new `daily_briefs.headline` column) and falls back to a decimal-safe splitter for pre-existing rows.

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