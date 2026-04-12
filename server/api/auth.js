import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const SIGN_MESSAGE = 'CheetahFi: verify wallet ownership';

/**
 * Verifies a Solana wallet signature.
 * Frontend signs: wallet.signMessage(Buffer.from(SIGN_MESSAGE))
 * and POSTs { address, signature } where signature is base58-encoded bytes.
 */
export function verifyWalletSignature(address, signatureBase58) {
  try {
    const pubkey = new PublicKey(address);
    const messageBytes = Buffer.from(SIGN_MESSAGE);
    const signatureBytes = bs58.decode(signatureBase58);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkey.toBytes());
  } catch {
    return false;
  }
}
