import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { useAccount, useChainId, usePublicClient } from "wagmi"

import { getFactoryAddress } from "../contracts/addresses"
import { erc20Abi, memeTokenFactoryAbi } from "../contracts/abi"
import { formatBn } from "../lib/format"

export default function PortfolioPage() {
  const { address } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const factory = getFactoryAddress(chainId)

  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolio", chainId, address],
    enabled: !!address && !!publicClient && !!factory,
    queryFn: async () => {
      if (!publicClient) throw new Error("No public client")
      if (!factory) throw new Error("Missing factory address")
      const length = (await publicClient.readContract({
        address: factory,
        abi: memeTokenFactoryAbi,
        functionName: "allTokensLength"
      })) as bigint
      const idx = Array.from({ length: Number(length) }, (_, i) => BigInt(i))

      const tokenAddrs = (await publicClient.multicall({
        contracts: idx.map((i) => ({
          address: factory,
          abi: memeTokenFactoryAbi,
          functionName: "allTokens",
          args: [i]
        }))
      })) as unknown as { result: `0x${string}` }[]
      const tokens = tokenAddrs.map((r) => r.result)

      const balances = (await publicClient.multicall({
        contracts: tokens.map((t) => ({
          address: t,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address!]
        }))
      })) as unknown as { result: bigint }[]

      const symbols = (await publicClient.multicall({
        contracts: tokens.map((t) => ({
          address: t,
          abi: erc20Abi,
          functionName: "symbol"
        }))
      })) as unknown as { result: string }[]

      return tokens
        .map((t, i) => ({
          token: t,
          symbol: symbols[i].result,
          balance: balances[i].result
        }))
        .filter((x) => x.balance > 0n)
        .sort((a, b) => (a.balance > b.balance ? -1 : 1))
    }
  })

  if (!factory) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
        当前仅支持 BSC 主网，请切换到 BSC（ChainId 56）
      </div>
    )
  }
  if (!address) return <div className="text-sm text-neutral-400">请先连接钱包</div>

  return (
    <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
      <div className="space-y-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
          <div className="text-base font-semibold">钱包</div>
          <div className="mt-2 text-xs text-neutral-500">{address}</div>
          <div className="mt-4 text-sm text-neutral-300">仅显示当前工厂创建的代币持仓。</div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-2xl font-semibold tracking-wide">持仓</div>
          <div className="text-xs text-neutral-400">共 {(data?.length ?? 0).toString()} 个</div>
        </div>

        {isLoading && <div className="text-sm text-neutral-400">加载中…</div>}
        {error && <div className="text-sm text-red-400">{String(error)}</div>}

        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70">
          <div className="grid grid-cols-[1fr,140px,90px] gap-3 border-b border-neutral-800 px-4 py-3 text-xs text-neutral-400">
            <div>代币</div>
            <div className="text-right">数量</div>
            <div className="text-right">操作</div>
          </div>
          <div className="divide-y divide-neutral-800">
            {(data ?? []).map((x) => (
              <div key={x.token} className="grid grid-cols-[1fr,140px,90px] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{x.symbol}</div>
                  <div className="truncate text-[11px] text-neutral-500">{x.token}</div>
                </div>
                <div className="text-right text-sm text-neutral-200">{formatBn(x.balance)}</div>
                <div className="flex justify-end">
                  <Link to={`/token/${x.token}`} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900">
                    去交易
                  </Link>
                </div>
              </div>
            ))}
            {(data?.length ?? 0) === 0 && !isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-neutral-400">暂无持仓</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
