import { useMemo, useState } from 'react'
import { Keypair } from '@solana/web3.js'
import { getSolanaKeypairFromStorage } from '../lib/solana/executeSwap'

export function useSolanaWallet() {
  const [nonce, setNonce] = useState(0)
  const { keypair, address } = useMemo(() => {
    const kp = getSolanaKeypairFromStorage()
    return {
      keypair: kp,
      address: kp ? kp.publicKey.toString() : null,
    }
  }, [nonce])

  const refresh = () => setNonce((n) => n + 1)

  return { keypair, address, refresh }
}
