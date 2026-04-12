import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { useChainId, usePublicClient } from "wagmi"

import { getFactoryAddress } from "../contracts/addresses"
import { bondingCurveMarketAbi, erc20Abi, memeTokenFactoryAbi } from "../contracts/abi"
import { formatBn } from "../lib/format"

type TokenRow = {
  token: `0x${string}`
  market: `0x${string}`
  creator: `0x${string}`
  name: string
  symbol: string
  description: string
  logo: string
  telegram: string
  twitter: string
  website: string
  templateId: bigint
  taxBps: bigint
  burnShareBps: bigint
  holderShareBps: bigint
  liquidityShareBps: bigint
  buybackShareBps: bigint
  migrated: boolean
  marketBnb: bigint
  targetRaise: bigint
  quotePriceBnbPerToken?: bigint
}

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v
  if (typeof v === "number") return BigInt(v)
  return BigInt(v as any)
}

export default function MarketPage() {
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const factory = getFactoryAddress(chainId)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<"all" | "sale" | "dex">("all")
  const [raise, setRaise] = useState<"all" | "6" | "16.5">("all")
  const [template, setTemplate] = useState<"all" | "base" | "tax">("all")
  const [filterOpen, setFilterOpen] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["market", chainId, factory],
    enabled: !!publicClient && !!factory,
    queryFn: async (): Promise<TokenRow[]> => {
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

      const infos = (await publicClient.multicall({
        contracts: tokens.map((t) => ({
          address: factory,
          abi: memeTokenFactoryAbi,
          functionName: "tokenInfo",
          args: [t]
        }))
      })) as unknown as {
        result: readonly [
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          bigint,
          string,
          string,
          string,
          string,
          string,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint
        ]
      }[]

      const names = (await publicClient.multicall({
        contracts: tokens.map((t) => ({
          address: t,
          abi: erc20Abi,
          functionName: "name"
        }))
      })) as unknown as { result: string }[]

      const symbols = (await publicClient.multicall({
        contracts: tokens.map((t) => ({
          address: t,
          abi: erc20Abi,
          functionName: "symbol"
        }))
      })) as unknown as { result: string }[]

      const markets = infos.map((r) => r.result[1])

      const marketStates = (await publicClient.multicall({
        contracts: markets.flatMap((m) => [
          { address: m, abi: bondingCurveMarketAbi, functionName: "migrated" as const },
          { address: m, abi: bondingCurveMarketAbi, functionName: "targetRaise" as const },
          {
            address: m,
            abi: bondingCurveMarketAbi,
            functionName: "quoteBuy" as const,
            args: [10n ** 17n]
          }
        ])
      })) as unknown as { result: unknown }[]

      const rows: TokenRow[] = []
      for (let i = 0; i < tokens.length; i++) {
        const info = infos[i].result
        const market = info[1]
        const migrated = marketStates[i * 3].result as boolean
        const targetRaise = marketStates[i * 3 + 1].result as bigint
        const quote = marketStates[i * 3 + 2].result as readonly [bigint, bigint]

        const marketBnb = await publicClient.getBalance({ address: market })
        const tokensOut = quote[0]
        const quotePriceBnbPerToken = tokensOut > 0n ? (10n ** 17n) / tokensOut : undefined

        rows.push({
          token: tokens[i],
          market,
          creator: info[2],
          name: names[i].result,
          symbol: symbols[i].result,
          description: info[4],
          logo: info[5],
          telegram: info[6],
          twitter: info[7],
          website: info[8],
          templateId: asBigInt(info[9]),
          taxBps: asBigInt(info[10]),
          burnShareBps: asBigInt(info[11]),
          holderShareBps: asBigInt(info[12]),
          liquidityShareBps: asBigInt(info[13]),
          buybackShareBps: asBigInt(info[14]),
          migrated,
          marketBnb,
          targetRaise,
          quotePriceBnbPerToken
        })
      }

      return rows.reverse()
    },
    refetchInterval: 5000
  })

  const rows = useMemo(() => {
    const list = data ?? []
    const qq = q.trim().toLowerCase()
    return list.filter((t) => {
      if (status === "dex" && !t.migrated) return false
      if (status === "sale" && t.migrated) return false
      if (raise === "6" && t.targetRaise !== 6000000000000000000n) return false
      if (raise === "16.5" && t.targetRaise !== 16500000000000000000n) return false
      if (template === "tax" && t.templateId !== 1n) return false
      if (template === "base" && t.templateId !== 0n) return false
      if (!qq) return true
      if (t.token.toLowerCase().includes(qq)) return true
      if (t.market.toLowerCase().includes(qq)) return true
      if (t.name.toLowerCase().includes(qq)) return true
      if (t.symbol.toLowerCase().includes(qq)) return true
      return false
    })
  }, [data, q, raise, status, template])

  function pct(marketBnb: bigint, targetRaise: bigint) {
    if (targetRaise <= 0n) return 0
    const p = (marketBnb * 10000n) / targetRaise
    const clipped = p > 10000n ? 10000n : p
    return Number(clipped) / 100
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px,1fr,320px]">
      <div
        className={
          filterOpen
            ? "fixed inset-0 z-50 bg-black/60 p-4 md:p-6 lg:static lg:z-auto lg:bg-transparent lg:p-0"
            : "hidden lg:block"
        }
        onClick={() => setFilterOpen(false)}
      >
        <div className="mx-auto max-w-md lg:max-w-none" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/90 p-4 lg:bg-neutral-950/70">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">筛选</div>
              <button
                type="button"
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 lg:hidden"
                onClick={() => setFilterOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs text-neutral-400">搜索</div>
                <input
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="名称 / Symbol / 地址"
                />
              </div>
              <div>
                <div className="text-xs text-neutral-400">状态</div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className={
                      status === "all"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setStatus("all")}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={
                      status === "sale"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setStatus("sale")}
                  >
                    募集中
                  </button>
                  <button
                    type="button"
                    className={
                      status === "dex"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setStatus("dex")}
                  >
                    已上线
                  </button>
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-400">打满线</div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className={
                      raise === "all"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setRaise("all")}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={
                      raise === "6"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setRaise("6")}
                  >
                    6
                  </button>
                  <button
                    type="button"
                    className={
                      raise === "16.5"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setRaise("16.5")}
                  >
                    16.5
                  </button>
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-400">机制</div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className={
                      template === "all"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setTemplate("all")}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={
                      template === "base"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setTemplate("base")}
                  >
                    基础
                  </button>
                  <button
                    type="button"
                    className={
                      template === "tax"
                        ? "rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                        : "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }
                    onClick={() => setTemplate("tax")}
                  >
                    税费
                  </button>
                </div>
              </div>
              <Link
                to="/create"
                className="block rounded-lg bg-white px-3 py-2 text-center text-sm font-medium text-black"
              >
                创建代币
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tracking-wide">新创建</div>
          </div>
          <div className="mr-32 flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900 lg:hidden"
              onClick={() => setFilterOpen(true)}
            >
              筛选
            </button>
            <button
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              onClick={() => refetch()}
            >
              刷新
            </button>
          </div>
        </div>

        {!factory && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            当前仅支持 BSC 主网，请切换到 BSC（ChainId 56）
          </div>
        )}
        {isLoading && <div className="text-sm text-neutral-400">加载中…</div>}
        {error && <div className="text-sm text-red-400">{String(error)}</div>}

        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70">
          <div className="hidden grid-cols-[1fr,120px,120px,90px] gap-3 border-b border-neutral-800 px-4 py-3 text-xs text-neutral-400 md:grid">
            <div>代币</div>
            <div className="text-right">价格</div>
            <div className="text-right">募资</div>
            <div className="text-right">操作</div>
          </div>
          <div className="space-y-3 p-3">
            {rows.map((t) => {
              const p = pct(t.marketBnb, t.targetRaise)
              return (
                <div key={t.token} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-3">
                  <div className="md:hidden">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/token/${t.token}`} className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                          {t.logo ? (
                            <img src={t.logo} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-semibold">
                              {t.name} <span className="text-neutral-400">({t.symbol})</span>
                            </div>
                            {t.templateId === 1n ? (
                              <div className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">税费</div>
                            ) : null}
                            {t.targetRaise === 6000000000000000000n ? (
                              <div className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200">6线</div>
                            ) : t.targetRaise === 16500000000000000000n ? (
                              <div className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200">16.5线</div>
                            ) : null}
                          </div>
                          <div className="mt-1 truncate text-xs text-neutral-500">{t.description}</div>
                        </div>
                      </Link>
                      <Link to={`/token/${t.token}`} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-medium text-black">
                        交易
                      </Link>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-neutral-300">
                      <div>
                        <div className="text-[11px] text-neutral-500">价格</div>
                        <div>{t.quotePriceBnbPerToken ? formatBn(t.quotePriceBnbPerToken, 18, 10) : "-"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-neutral-500">募资</div>
                        <div>
                          {formatBn(t.marketBnb)} / {formatBn(t.targetRaise)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 via-sky-400/80 to-fuchsia-400/80"
                        style={{ width: `${p}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                      <div className="truncate">Token: {t.token}</div>
                      <div className="shrink-0">打满 {p.toFixed(2)}%</div>
                    </div>
                  </div>

                  <div className="hidden grid-cols-[1fr,120px,120px,90px] items-center gap-3 md:grid">
                    <div className="min-w-0">
                      <Link to={`/token/${t.token}`} className="block">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                            {t.logo ? (
                              <img src={t.logo} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-semibold">
                                {t.name} <span className="text-neutral-400">({t.symbol})</span>
                              </div>
                              {t.templateId === 1n ? (
                                <div className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">税费</div>
                              ) : null}
                              {t.targetRaise === 6000000000000000000n ? (
                                <div className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200">6线</div>
                              ) : t.targetRaise === 16500000000000000000n ? (
                                <div className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200">16.5线</div>
                              ) : null}
                              {t.migrated ? (
                                <div className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">已上线</div>
                              ) : (
                                <div className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">募集中</div>
                              )}
                            </div>
                            <div className="mt-1 truncate text-xs text-neutral-500">{t.description}</div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 via-sky-400/80 to-fuchsia-400/80"
                                style={{ width: `${p}%` }}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                              <div className="truncate">Token: {t.token}</div>
                              <div className="shrink-0">打满 {p.toFixed(2)}%</div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </div>
                    <div className="text-right text-xs text-neutral-300">
                      {t.quotePriceBnbPerToken ? formatBn(t.quotePriceBnbPerToken, 18, 10) : "-"}
                      <div className="text-[11px] text-neutral-500">BNB/Token</div>
                    </div>
                    <div className="text-right text-xs text-neutral-300">
                      {formatBn(t.marketBnb)} / {formatBn(t.targetRaise)}
                      <div className="text-[11px] text-neutral-500">BNB</div>
                    </div>
                    <div className="flex justify-end">
                      <Link to={`/token/${t.token}`} className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black">
                        交易
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
            {rows.length === 0 && !isLoading ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-400">
                暂无数据
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="hidden space-y-3 lg:block">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
          <div className="text-base font-semibold">面板</div>
          <div className="mt-3 space-y-2 text-sm text-neutral-300">
            <div className="flex items-center justify-between">
              <div className="text-neutral-400">链</div>
              <div>{chainId}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-neutral-400">工厂</div>
              <div className="max-w-[180px] truncate">{factory ?? "-"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
