import { http, createConfig } from "wagmi"
import { bsc, bscTestnet } from "wagmi/chains"
import { injected, coinbaseWallet } from "wagmi/connectors"
import type { Chain } from "viem"

const connectors = [
  injected(),
  coinbaseWallet({
    appName: "龙虾"
  })
]

const bscRpcUrl = (import.meta.env.VITE_BSC_RPC_URL as string | undefined) ?? "https://bsc-dataseed.bnbchain.org"
const bscTestnetRpcUrl =
  (import.meta.env.VITE_BSC_TESTNET_RPC_URL as string | undefined) ?? "https://bsc-testnet-dataseed.bnbchain.org"

function isLocalRpc(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)
}

export const testnetChain: Chain = isLocalRpc(bscTestnetRpcUrl)
  ? ({
      id: 31337,
      name: "Local Testnet",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: {
        default: { http: [bscTestnetRpcUrl] },
        public: { http: [bscTestnetRpcUrl] }
      }
    } satisfies Chain)
  : bscTestnet

export const wagmiConfig = createConfig({
  chains: [bsc, testnetChain],
  connectors,
  transports: {
    [bsc.id]: http(bscRpcUrl),
    [testnetChain.id]: http(bscTestnetRpcUrl)
  }
})
