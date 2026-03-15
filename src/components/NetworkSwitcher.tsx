import { useWallet } from './WalletProvider'
import { NETWORK_CONFIG } from '../lib/walletConfig'

type LocalNetwork = 'mainnet' | 'bsc' | 'base'

const ORDER: LocalNetwork[] = ['mainnet', 'bsc', 'base']

export function NetworkSwitcher() {
  const { network, switchNetwork, connecting } = useWallet()

  return (
    <div className="network-switcher">
      {ORDER.map((n) => (
        <button
          key={n}
          className={n === network ? 'active' : ''}
          disabled={connecting}
          onClick={() => void switchNetwork(n)}
        >
          {NETWORK_CONFIG[n].symbol}
        </button>
      ))}
    </div>
  )
}

