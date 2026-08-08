import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  heliusApiKey: process.env.HELIUS_API_KEY,
  heliusRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  aiModel: process.env.AI_MODEL || 'deepseek/deepseek-v4-flash',
  // Primary is a REASONING model. It follows the honesty rules noticeably better
  // than the non-reasoning alternatives, which is why it stays primary — but on
  // some inputs it spends the whole token budget thinking and emits nothing
  // (verified: 8000 tokens consumed, 0 emitted; `reasoning:{exclude:true}` and
  // `effort:'low'` are both ignored by the provider, so more budget cannot fix it).
  //
  // The fallback therefore MUST be non-reasoning, or it fails the same way —
  // qwen3.7-flash does. mistral-small-24b was verified against the exact input
  // that starves the primary: 0 reasoning tokens, valid JSON. It leaks causal
  // language more often, which is why it is the fallback and not the primary;
  // the honesty guard in brief.js catches those leaks either way.
  aiModelFallback: process.env.AI_MODEL_FALLBACK || 'mistralai/mistral-small-24b-instruct-2501',
  dbPath: process.env.DB_PATH || './vrynn.db',
  alertCooldownMs: 30 * 60 * 1000,   // 30 min between same-wallet alerts
  healthFactorWarning: 1.5,
  healthFactorCritical: 1.2,
  monitorIntervalSeconds: 60,
  // X (Twitter)
  xApiKey:            process.env.X_API_KEY,
  xApiSecret:         process.env.X_API_SECRET,
  xAccessToken:       process.env.X_ACCESS_TOKEN,
  xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  adminSecret:        process.env.ADMIN_SECRET,
  fredApiKey:         process.env.FRED_API_KEY,
  coinalyzeApiKey:    process.env.COINALYZE_API_KEY,
};
