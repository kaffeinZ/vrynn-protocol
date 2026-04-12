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

function buildPrompt(walletAddress, positions) {
  const positionLines = positions.map((p) => {
    const hf = p.healthFactor != null ? p.healthFactor.toFixed(3) : 'N/A (no debt)';
    const balanceLines = p.balances
      .filter((b) => b.assetUsd > 0.01 || b.liabilityUsd > 0.01)
      .map((b) =>
        `    ${b.token}: deposited $${b.assetUsd.toFixed(2)}, borrowed $${b.liabilityUsd.toFixed(2)} (price $${b.priceUsd.toFixed(4)})`
      )
      .join('\n');
    return (
      `Protocol: ${p.protocol}\n` +
      `Health Factor: ${hf}\n` +
      `Collateral: $${p.collateralUsd.toFixed(2)} | Borrow: $${p.borrowUsd.toFixed(2)}\n` +
      `Position type: ${p.positionType ?? 'unknown'}\n` +
      `Balances:\n${balanceLines || '    (no active balances)'}`
    );
  }).join('\n\n');

  return (
    `You are a DeFi risk analyst specialising in Solana lending protocols.\n\n` +
    `Wallet: ${walletAddress}\n\n` +
    `Current positions:\n${positionLines}\n\n` +
    `Task: Analyse the liquidation risk across these positions.\n` +
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
export async function analyzeRisk(walletAddress, positions) {
  if (!positions.length) return null;

  const prompt = buildPrompt(walletAddress, positions);

  let responseText;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cheetahfi.app',
        'X-Title': 'CheetahFi',
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
