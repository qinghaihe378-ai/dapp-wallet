import { http, createConfig } from "wagmi"
import { bsc, bscTestnet } from "wagmi/chains"
import { injected, coinbaseWallet } from "wagmi/connectors"

const connectors = [
  injected(),
  coinbaseWallet({
    appName: "龙虾"
  })
]

const bscRpcUrl = (import.meta.env.VITE_BSC_RPC_URL as string | undefined) ?? "https://bsc-dataseed.bnbchain.org"
const bscTestnetRpcUrl =
  (import.meta.env.VITE_BSC_TESTNET_RPC_URL as string | undefined) ?? "https://bsc-testnet-dataseed.bnbchain.org"

export const wagmiConfig = createConfig({
  chains: [bsc, bscTestnet],
  connectors,
  transports: {
    [bsc.id]: http(bscRpcUrl),
    [bscTestnet.id]: http(bscTestnetRpcUrl)
  }
})
