import { http, createConfig } from "wagmi"
import { bsc } from "wagmi/chains"
import { injected } from "wagmi/connectors"

const connectors = [
  injected({
    unstable_shimAsyncInject: 2000,
    target: {
      id: "injected",
      name: "Injected",
      provider(window) {
        const w = window as unknown as any
        const eth = w?.ethereum
        const multi = Array.isArray(eth?.providers) ? eth.providers : []
        const candidates = [
          ...multi,
          eth,
          w?.okxwallet,
          w?.tokenpocket,
          w?.tpwallet,
          w?.bitkeep?.ethereum,
          w?.web3?.currentProvider
        ].filter(Boolean)
        return candidates.find((p: any) => typeof p?.request === "function")
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
