import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  heliusApiKey: process.env.HELIUS_API_KEY,
  heliusRpcUrl: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  aiModel: process.env.AI_MODEL || 'deepseek/deepseek-v3.2',
  dbPath: process.env.DB_PATH || './cheetahfi.db',
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
};
