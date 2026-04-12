import { http, createConfig } from "wagmi"
import { bsc } from "wagmi/chains"
import { injected } from "wagmi/connectors"
import { getPreferredInjectedProvider } from "./embeddedWalletBridge"

const connectors = [
  injected({
    unstable_shimAsyncInject: 2000,
    target: {
      id: "injected",
      name: "Injected",
      provider(window) {
        return getPreferredInjectedProvider(window as any) as any
      }
    }
  })
]

const bscRpcUrl = (import.meta.env.VITE_BSC_RPC_URL as string | undefined) ?? "https://bsc-dataseed.bnbchain.org"

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors,
  transports: {
    [bsc.id]: http(bscRpcUrl)
  }
})
