/**
 * AI risk analysis via OpenRouter.
 *
 * Sends position data to an LLM and returns a structured risk assessment.
 * Only called from the monitor loop when health factor changes significantly,
 * so API usage stays low.
 */

import { config } from './config.js';
import { saveAiAnalysis } from './db.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(walletAddress, positions, priceTrendContext = null) {
  const positionLines = positions.map((p) => {
    if (p.positionType === 'perp') {
      const distPct  = p.distancePct != null ? p.distancePct.toFixed(2) : 'N/A';
      const liqPrice = p.liquidationPrice != null ? `$${p.liquidationPrice.toFixed(4)}` : 'N/A';
      const curPrice = p.currentPrice != null ? `$${p.currentPrice.toFixed(4)}` : 'N/A';
      const pnl      = p.unrealizedPnl != null ? `$${p.unrealizedPnl.toFixed(2)}` : 'N/A';
      const size     = p.collateralUsd != null ? `$${p.collateralUsd.toFixed(2)}` : 'N/A';
      return (
        `Protocol: ${p.protocol} (PERPETUAL)\n` +
        `Side: ${p.side ?? 'N/A'} | Leverage: ${p.leverage ?? 'N/A'}x | Size: ${size}\n` +
        `Current price: ${curPrice} | Liquidation price: ${liqPrice}\n` +
        `Distance from liquidation: ${distPct}%\n` +
        `Unrealised PnL: ${pnl}`
      );
    }

    const hf = p.healthFactor != null ? p.healthFactor.toFixed(3) : 'N/A (no debt)';
    const balanceLines = (p.balances ?? [])
      .filter((b) => b.assetUsd > 0.01 || b.liabilityUsd > 0.01)
      .map((b) =>
        `    ${b.token}: deposited $${b.assetUsd.toFixed(2)}, borrowed $${b.liabilityUsd.toFixed(2)} (price $${b.priceUsd.toFixed(4)})`
      )
      .join('\n');
    return (
      `Protocol: ${p.protocol} (LENDING)\n` +
      `Health Factor: ${hf}\n` +
      `Collateral: $${p.collateralUsd.toFixed(2)} | Borrow: $${p.borrowUsd.toFixed(2)}\n` +
      `Position type: ${p.positionType ?? 'unknown'}\n` +
      `Balances:\n${balanceLines || '    (no active balances)'}`
    );
  }).join('\n\n');

  return (
    `You are a DeFi risk analyst specialising in Solana protocols (lending and perpetuals).\n\n` +
    `Wallet: ${walletAddress}\n\n` +
    `Current positions:\n${positionLines}\n\n` +
    `Task: Analyse the liquidation risk across these positions.\n\n` +
    `RULES:\n` +
    `- LENDING positions: Health Factor <1.0 = liquidated. <1.2 = CRITICAL. <1.5 = HIGH. <2.0 = MEDIUM. ≥2.0 = LOW.\n` +
    `- PERPETUAL positions: the risk metric is "distance from liquidation" (%). CRITICAL <5%. HIGH <10%. WARNING <20%. SAFE ≥20%. Do NOT use health factor language for perps — use price and distance. State the current price, liquidation price, and how many dollars or percent SOL must move to trigger liquidation.\n` +
    `- If position_type is "lst_loop": collateral and debt move together with SOL price. SOL dropping does NOT affect the health factor. The ONLY risk is a depeg between the two tokens. NEVER say "if SOL falls" for lst_loop — it is factually wrong.\n` +
    `${priceTrendContext ? `Recent price trends (last 6h):\n${priceTrendContext}\nUse these trends to estimate time-to-liquidation if the trend continues. Be specific: "at this rate, liquidation could occur in approximately X hours."\n\n` : ''}` +
    `Respond in this exact format — nothing else:\n` +
    `RISK_LEVEL: <LOW|MEDIUM|HIGH|CRITICAL>\n` +
    `ANALYSIS: <2-3 sentences explaining the risk and what the user should do>`
  );
}

// ── Parser ────────────────────────────────────────────────────────────────

function parseResponse(text) {
  const levelMatch = text.match(/RISK_LEVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/i);
  const analysisMatch = text.match(/ANALYSIS:\s*(.+)/is);

  return {
    riskLevel: levelMatch ? levelMatch[1].toUpperCase() : 'MEDIUM',
    analysis: analysisMatch ? analysisMatch[1].trim() : text.trim(),
  };
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Analyse positions for a wallet and persist the result.
 * Returns { riskLevel, analysis } or null on failure.
 */
export async function analyzeRisk(walletAddress, positions, priceTrendContext = null) {
  if (!positions.length) return null;

  const prompt = buildPrompt(walletAddress, positions, priceTrendContext);

  let responseText;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vrynn.xyz',
        'X-Title': 'Vrynn',
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${err}`);
    }

    const data = await res.json();
    responseText = data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    console.error('[ai] OpenRouter call failed:', err.message);
    return null;
  }

  const { riskLevel, analysis } = parseResponse(responseText);

  // Persist — use 'portfolio' key when aggregating multiple protocols
  const protocol = positions.length === 1 ? positions[0].protocol : 'portfolio';
  const healthFactor = positions.length === 1 ? positions[0].healthFactor : null;

  saveAiAnalysis({ walletAddress, protocol, riskLevel, analysis, healthFactor });

  console.log(`[ai] ${walletAddress.slice(0, 8)}… → ${riskLevel}`);
  return { riskLevel, analysis };
}
