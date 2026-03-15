import { Connection, PublicKey } from '@solana/web3.js'
import { NETWORK_CONFIG } from '../walletConfig'
import type { SolanaToken } from './tokens'

const RPC_ENDPOINT = NETWORK_CONFIG.solana.rpcUrls[0]

export async function readSolanaBalance(
  address: string,
  token: SolanaToken,
): Promise<string> {
  const conn = new Connection(RPC_ENDPOINT)
  const pubkey = new PublicKey(address)

  if (token.isNative) {
    const lamports = await conn.getBalance(pubkey)
    const sol = lamports / 1e9
    return sol.toFixed(6)
  }

  const accounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
    mint: new PublicKey(token.mint),
  })

  if (accounts.value.length === 0) return '0'
  const info = accounts.value[0].account.data.parsed?.info
  const amount = info?.tokenAmount?.uiAmount ?? 0
  return String(amount)
}
