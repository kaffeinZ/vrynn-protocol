import { Connection, Keypair } from '@solana/web3.js';
import { MarginfiClient, getConfig } from '@mrgnlabs/marginfi-client-v2';
import { NodeWallet } from '@mrgnlabs/mrgn-common';
import fs from 'fs';

const keypairPath = process.argv[2];
if (!keypairPath) {
  console.error('Usage: node withdraw-marginfi.mjs /path/to/keypair.json');
  process.exit(1);
}

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));
const wallet  = new NodeWallet(keypair);
console.log(`Wallet: ${keypair.publicKey.toBase58()}`);

const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=0e491a10-4dbe-42e9-bd5d-dad6dbdf1799`,
  { commitment: 'confirmed' }
);

const config  = getConfig('production');
const client  = await MarginfiClient.fetch(config, wallet, connection);
const accounts = await client.getMarginfiAccountsForAuthority(keypair.publicKey);

if (!accounts.length) {
  console.log('No MarginFi accounts found for this wallet.');
  process.exit(0);
}

const account = accounts[0];
console.log(`MarginFi account: ${account.address.toBase58()}`);

const activeBalances = account.activeBalances.filter(b => b.active);
if (!activeBalances.length) {
  console.log('No active balances to withdraw.');
  process.exit(0);
}

for (const balance of activeBalances) {
  const bank = client.getBankByPk(balance.bankPk);
  const symbol = bank?.tokenSymbol ?? balance.bankPk.toBase58().slice(0, 8);
  const amount = balance.computeQuantityUi(bank).assets;
  console.log(`Withdrawing ${amount.toFixed(6)} ${symbol}...`);
  try {
    const sig = await account.withdraw(amount, bank.address, true);
    console.log(`  ✓ ${symbol} withdrawn — tx: ${sig}`);
  } catch (err) {
    console.error(`  ✗ ${symbol} failed: ${err.message}`);
  }
}

console.log('Done.');