import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract
} from "wagmi"
import { maxUint256, parseUnits } from "viem"

import { getFactoryAddress } from "../contracts/addresses"
import { bondingCurveMarketAbi, erc20Abi, memeTokenFactoryAbi, memeTokenTaxAbi } from "../contracts/abi"
import { formatBn } from "../lib/format"

function isAddr(v?: string): v is `0x${string}` {
  return !!v && /^0x[0-9a-fA-F]{40}$/.test(v)
}

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v
  if (typeof v === "number") return BigInt(v)
  return BigInt(v as any)
}

export default function TokenPage() {
  const { token: tokenParam } = useParams()
  const token = isAddr(tokenParam) ? tokenParam : undefined
  const chainId = useChainId()
  const factory = getFactoryAddress(chainId)
  const publicClient = usePublicClient()
  const { address } = useAccount()

  const { data: info, refetch } = useQuery({
    queryKey: ["tokenInfo", chainId, token],
    enabled: !!token && !!publicClient && !!factory,
    queryFn: async () => {
      if (!publicClient) throw new Error("No public client")
      if (!factory) throw new Error("Missing factory address")
      const r = (await publicClient.readContract({
        address: factory,
        abi: memeTokenFactoryAbi,
        functionName: "tokenInfo",
        args: [token!]
      })) as unknown as readonly [
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
      const market = r[1]
      const [name, symbol, migrated, targetRaise] = (await publicClient.multicall({
        contracts: [
          { address: token!, abi: erc20Abi, functionName: "name" as const },
          { address: token!, abi: erc20Abi, functionName: "symbol" as const },
          { address: market, abi: bondingCurveMarketAbi, functionName: "migrated" as const },
          { address: market, abi: bondingCurveMarketAbi, functionName: "targetRaise" as const }
        ]
      })) as unknown as [{ result: string }, { result: string }, { result: boolean }, { result: bigint }]
      const marketBnb = await publicClient.getBalance({ address: market })

      return {
        token: token!,
        market,
        creator: r[2],
        description: r[4],
        logo: r[5],
        telegram: r[6],
        twitter: r[7],
        website: r[8],
        templateId: asBigInt(r[9]),
        taxBps: asBigInt(r[10]),
        burnShareBps: asBigInt(r[11]),
        holderShareBps: asBigInt(r[12]),
        liquidityShareBps: asBigInt(r[13]),
        buybackShareBps: asBigInt(r[14]),
        name: name.result,
        symbol: symbol.result,
        migrated: migrated.result,
        targetRaise: targetRaise.result,
        marketBnb
      }
    },
    refetchInterval: 5000
  })

  useWatchContractEvent({
    address: info?.market,
    abi: bondingCurveMarketAbi,
    eventName: "Buy",
    enabled: !!info?.market,
    onLogs: () => void refetch()
  })
  useWatchContractEvent({
    address: info?.market,
    abi: bondingCurveMarketAbi,
    eventName: "Sell",
    enabled: !!info?.market,
    onLogs: () => void refetch()
  })
  useWatchContractEvent({
    address: info?.market,
    abi: bondingCurveMarketAbi,
    eventName: "Migrated",
    enabled: !!info?.market,
    onLogs: () => void refetch()
  })

  if (!token) return <div className="text-sm text-red-400">地址无效</div>
  if (!factory) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
        当前仅支持 BSC 主网，请切换到 BSC（ChainId 56）
      </div>
    )
  }
  if (!info) return <div className="text-sm text-neutral-400">加载中…</div>

  const targetRaiseLabel =
    info.targetRaise === 6000000000000000000n ? "6" : info.targetRaise === 16500000000000000000n ? "16.5" : undefined
  const progressPct =
    info.targetRaise > 0n
      ? Number(((info.marketBnb * 10000n) / info.targetRaise > 10000n ? 10000n : (info.marketBnb * 10000n) / info.targetRaise)) /
        100
      : 0

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,380px]">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
              {info.logo ? <img src={info.logo} alt="" className="h-full w-full object-cover" /> : <div />}
            </div>
            <div>
              <div className="text-lg font-semibold">
                {info.name} <span className="text-neutral-400">({info.symbol})</span>
              </div>
              <div className="text-sm text-neutral-400">{info.description}</div>
              {info.templateId === 1n ? (
                <div className="mt-1 text-xs text-neutral-500">
                  税率：{(Number(info.taxBps) / 100).toFixed(2)}%｜
                  分红 {(Number(info.holderShareBps) / 100).toFixed(2)}%｜
                  销毁 {(Number(info.burnShareBps) / 100).toFixed(2)}%｜
                  加池 {(Number(info.liquidityShareBps) / 100).toFixed(2)}%｜
                  回流 {(Number(info.buybackShareBps) / 100).toFixed(2)}%
                </div>
              ) : (
                <div className="mt-1 text-xs text-neutral-500">基础版（无税）</div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {info.telegram ? (
                  <a
                    href={info.telegram}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-300 hover:text-white"
                  >
                    Telegram
                  </a>
                ) : null}
                {info.twitter ? (
                  <a
                    href={info.twitter}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-300 hover:text-white"
                  >
                    Twitter
                  </a>
                ) : null}
                {info.website ? (
                  <a
                    href={info.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-300 hover:text-white"
                  >
                    Website
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          <div className="text-right text-sm text-neutral-300">
            <div>募资：{formatBn(info.marketBnb)} / {formatBn(info.targetRaise)} BNB</div>
            <div className="text-neutral-500">打满进度：{progressPct.toFixed(2)}%</div>
            <div className="text-neutral-500">打满线：{targetRaiseLabel ?? formatBn(info.targetRaise)} BNB</div>
            <div className="text-neutral-500">{info.migrated ? "已上线PancakeSwap V2" : "Bonding Curve交易中"}</div>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 via-sky-400/80 to-fuchsia-400/80"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-4 space-y-1 text-xs text-neutral-500">
          <div>Token: {info.token}</div>
          <div>Market: {info.market}</div>
          <div>Creator: {info.creator}</div>
        </div>
      </div>

      <div className="lg:sticky lg:top-24">
        <TradePanel
          token={info.token}
          market={info.market}
          isTax={info.templateId === 1n}
          disabled={!address || info.migrated}
        />
      </div>
    </div>
  )
}

function TradePanel(props: { token: `0x${string}`; market: `0x${string}`; isTax: boolean; disabled: boolean }) {
  const { address } = useAccount()
  const [bnbIn, setBnbIn] = useState("0.1")
  const [tokensIn, setTokensIn] = useState("1000000")
  const [slippagePct, setSlippagePct] = useState("1")

  const bnbInWei = useMemo(() => {
    try {
      return parseUnits(bnbIn || "0", 18)
    } catch {
      return 0n
    }
  }, [bnbIn])

  const tokensInWei = useMemo(() => {
    try {
      return parseUnits(tokensIn || "0", 18)
    } catch {
      return 0n
    }
  }, [tokensIn])

  const { data: buyQuote } = useReadContract({
    address: props.market,
    abi: bondingCurveMarketAbi,
    functionName: "quoteBuy",
    args: [bnbInWei]
  })

  const { data: sellQuote } = useReadContract({
    address: props.market,
    abi: bondingCurveMarketAbi,
    functionName: "quoteSell",
    args: [tokensInWei]
  })

  const tokensOut = (buyQuote?.[0] as bigint | undefined) ?? 0n
  const buyFee = (buyQuote?.[1] as bigint | undefined) ?? 0n
  const bnbOut = (sellQuote?.[0] as bigint | undefined) ?? 0n
  const sellFee = (sellQuote?.[1] as bigint | undefined) ?? 0n

  const slippageBps = useMemo(() => {
    const n = Number(slippagePct || "0")
    if (!Number.isFinite(n) || n <= 0) return 0
    const clamped = Math.min(n, 50)
    return Math.round(clamped * 100)
  }, [slippagePct])

  const minTokensOut = useMemo(() => (tokensOut * BigInt(10_000 - slippageBps)) / 10_000n, [tokensOut, slippageBps])
  const minBnbOut = useMemo(() => (bnbOut * BigInt(10_000 - slippageBps)) / 10_000n, [bnbOut, slippageBps])

  const { data: withdrawableDividend } = useReadContract({
    address: props.token,
    abi: memeTokenTaxAbi,
    functionName: "withdrawableDividendOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: props.isTax && !!address }
  })
  const withdrawable = (withdrawableDividend as bigint | undefined) ?? 0n

  const { data: allowance } = useReadContract({
    address: props.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x0000000000000000000000000000000000000000", props.market]
  })

  const needsApprove = address ? ((allowance as bigint | undefined) ?? 0n) < tokensInWei : false

  const { writeContract, data: txHash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  const {
    writeContract: writeDividend,
    data: dividendHash,
    isPending: isDividendPending,
    error: dividendError
  } = useWriteContract()
  const { isLoading: isDividendConfirming } = useWaitForTransactionReceipt({ hash: dividendHash })

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
      <div className="text-lg font-semibold tracking-wide">实时买卖</div>

      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-neutral-400">滑点（%）</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={slippagePct}
              onChange={(e) => setSlippagePct(e.target.value)}
            />
          </div>
          <div className="text-xs text-neutral-500">
            买费：{formatBn(buyFee)} BNB<br />
            卖费：{formatBn(sellFee)} BNB
          </div>
        </div>

        {props.isTax ? (
          <>
            <div className="grid grid-cols-[1fr,auto] items-center gap-3 rounded-xl border border-neutral-800 p-3">
              <div className="text-xs text-neutral-500">可领取分红：{formatBn(withdrawable)} BNB</div>
              <button
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                disabled={!address || withdrawable === 0n || isDividendPending || isDividendConfirming}
                onClick={() =>
                  writeDividend({
                    address: props.token,
                    abi: memeTokenTaxAbi,
                    functionName: "claimDividend",
                    args: []
                  })
                }
              >
                {isDividendPending || isDividendConfirming ? "领取中…" : "领取分红"}
              </button>
            </div>
            {dividendError && <div className="text-sm text-red-400">{dividendError.message}</div>}
            {dividendHash && <div className="text-xs text-neutral-500">Tx: {dividendHash}</div>}
          </>
        ) : null}

        <div className="rounded-xl border border-neutral-800 p-3">
          <div className="text-sm font-medium">买入</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-neutral-400">投入BNB</div>
              <input
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                value={bnbIn}
                onChange={(e) => setBnbIn(e.target.value)}
              />
            </div>
            <div className="text-xs text-neutral-500">
              预计得到：{formatBn(tokensOut)} Token<br />
              最少得到：{formatBn(minTokensOut)} Token
            </div>
          </div>
          <button
            className="mt-3 w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
            disabled={props.disabled || isPending || isConfirming || bnbInWei === 0n}
            onClick={() =>
              writeContract({
                address: props.market,
                abi: bondingCurveMarketAbi,
                functionName: "buy",
                args: [address!, minTokensOut],
                value: bnbInWei
              })
            }
          >
            {isPending || isConfirming ? "处理中…" : "买入"}
          </button>
        </div>

        <div className="rounded-xl border border-neutral-800 p-3">
          <div className="text-sm font-medium">卖出</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-neutral-400">卖出Token</div>
              <input
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                value={tokensIn}
                onChange={(e) => setTokensIn(e.target.value)}
              />
            </div>
            <div className="text-xs text-neutral-500">
              预计得到：{formatBn(bnbOut)} BNB<br />
              最少得到：{formatBn(minBnbOut)} BNB
            </div>
          </div>

          {needsApprove ? (
            <button
              className="mt-3 w-full rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
              disabled={props.disabled || isPending || isConfirming}
              onClick={() =>
                writeContract({
                  address: props.token,
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [props.market, maxUint256]
                })
              }
            >
              {isPending || isConfirming ? "处理中…" : "先授权"}
            </button>
          ) : (
            <button
              className="mt-3 w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
              disabled={props.disabled || isPending || isConfirming || tokensInWei === 0n}
              onClick={() =>
                writeContract({
                  address: props.market,
                  abi: bondingCurveMarketAbi,
                  functionName: "sell",
                  args: [tokensInWei, minBnbOut, address!]
                })
              }
            >
              {isPending || isConfirming ? "处理中…" : "卖出"}
            </button>
          )}
        </div>

        {error && <div className="text-sm text-red-400">{error.message}</div>}
        {txHash && <div className="text-xs text-neutral-500">Tx: {txHash}</div>}
      </div>
    </div>
  )
}
