import { useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { parseEventLogs } from "viem"

import { getFactoryAddress } from "../contracts/addresses"
import { memeTokenFactoryAbi } from "../contracts/abi"

export default function CreateTokenPage() {
  const navigate = useNavigate()
  const { address } = useAccount()
  const chainId = useChainId()
  const factory = getFactoryAddress(chainId)

  const [name, setName] = useState("")
  const [symbol, setSymbol] = useState("")
  const [description, setDescription] = useState("")
  const [logo, setLogo] = useState("")
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement | null>(null)
  const [telegram, setTelegram] = useState("")
  const [twitter, setTwitter] = useState("")
  const [website, setWebsite] = useState("")
  const [targetRaiseOption, setTargetRaiseOption] = useState<"16.5" | "6">("16.5")
  const [templateId, setTemplateId] = useState<0 | 1>(0)
  const [taxRatePercent, setTaxRatePercent] = useState("1.0")
  const [burnSharePercent, setBurnSharePercent] = useState("20")
  const [holderSharePercent, setHolderSharePercent] = useState("40")
  const [buybackSharePercent, setBuybackSharePercent] = useState("20")

  const { data: creationFee } = useReadContract({
    address: factory,
    abi: memeTokenFactoryAbi,
    functionName: "creationFee",
    query: { enabled: !!factory }
  })

  const { writeContract, data: txHash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash
  })

  const taxConfig = useMemo(() => {
    if (templateId === 0) {
      return {
        ok: true as const,
        templateId: 0 as const,
        taxBps: 0,
        burnShareBps: 0,
        holderShareBps: 0,
        liquidityShareBps: 0,
        buybackShareBps: 0
      }
    }

    const taxPct = Number(taxRatePercent || "0")
    if (!Number.isFinite(taxPct)) return { ok: false as const, reason: "税率不合法" }
    const taxBps = Math.round(taxPct * 100)
    if (taxBps < 10 || taxBps > 500) return { ok: false as const, reason: "税率范围 0.1%-5%" }

    const burnPct = Number(burnSharePercent || "0")
    const holderPct = Number(holderSharePercent || "0")
    const buybackPct = Number(buybackSharePercent || "0")
    if (![burnPct, holderPct, buybackPct].every((v) => Number.isFinite(v) && v >= 0)) {
      return { ok: false as const, reason: "分配比例不合法" }
    }

    const burnShareBps = Math.round(burnPct * 100)
    const holderShareBps = Math.round(holderPct * 100)
    const liquidityShareBps = 0
    const buybackShareBps = Math.round(buybackPct * 100)
    const sum = burnShareBps + holderShareBps + liquidityShareBps + buybackShareBps
    if (sum !== 10_000) return { ok: false as const, reason: "分配比例总和需要等于 100%" }

    return {
      ok: true as const,
      templateId: 1 as const,
      taxBps,
      burnShareBps,
      holderShareBps,
      liquidityShareBps,
      buybackShareBps
    }
  }, [
    templateId,
    taxRatePercent,
    burnSharePercent,
    holderSharePercent,
    buybackSharePercent
  ])

  const disabledReason = useMemo(() => {
    if (!factory) return "未检测到 Factory（请确认当前链为 BSC 56）"
    if (!address) return "请先连接钱包"
    if (!name.trim() || !symbol.trim()) return "请填写名称与符号"
    if (creationFee === undefined) return "读取创建费用失败"
    if (!taxConfig.ok) return taxConfig.reason
    if (isPending) return "提交中…"
    if (isConfirming) return "确认中…"
    return null
  }, [factory, address, name, symbol, creationFee, taxConfig, isPending, isConfirming])

  const disabled = Boolean(disabledReason)

  return (
    <div className="space-y-3">
      <div className="text-2xl font-semibold tracking-wide">创建你的代币</div>

      <div>
        <input
          ref={logoInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!f.type.startsWith("image/")) {
              setLogo("")
              setLogoError("请选择图片文件")
              if (logoInputRef.current) logoInputRef.current.value = ""
              return
            }
            if (f.size > 1024 * 1024) {
              setLogo("")
              setLogoError("图片过大，请选择 1MB 以内")
              if (logoInputRef.current) logoInputRef.current.value = ""
              return
            }
            const r = new FileReader()
            r.onload = () => {
              const v = typeof r.result === "string" ? r.result : ""
              setLogo(v)
              setLogoError(null)
            }
            r.onerror = () => {
              setLogo("")
              setLogoError("读取图片失败")
            }
            r.readAsDataURL(f)
          }}
        />
        <div
          className="group relative mt-1 aspect-square w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 hover:border-neutral-600"
          role="button"
          tabIndex={0}
          onClick={() => logoInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") logoInputRef.current?.click()
          }}
        >
          {logo ? (
            <img src={logo} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
              点击上传封面（512×512，1MB以内）
            </div>
          )}
          {logo ? (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="text-xs text-neutral-200">点击更换</div>
              <button
                type="button"
                className="rounded-md border border-neutral-700 bg-black/40 px-3 py-1.5 text-xs text-neutral-200 hover:bg-black/60"
                onClick={(e) => {
                  e.stopPropagation()
                  setLogo("")
                  setLogoError(null)
                  if (logoInputRef.current) logoInputRef.current.value = ""
                }}
              >
                清除
              </button>
            </div>
          ) : null}
        </div>
        {logoError && <div className="mt-2 text-sm text-red-400">{logoError}</div>}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
        <div className="grid gap-3">
          <div>
            <div className="text-sm text-neutral-300">名称</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：龙虾 Inu"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">符号</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="例如：龙虾"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">描述</div>
            <textarea
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话介绍"
              rows={3}
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">Telegram 链接（可选）</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="https://t.me/xxx"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">Twitter 链接（可选）</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              placeholder="https://twitter.com/xxx 或 https://x.com/xxx"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">Website 链接（可选）</div>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div>
            <div className="text-sm text-neutral-300">打满线</div>
            <select
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={targetRaiseOption}
              onChange={(e) => setTargetRaiseOption(e.target.value === "6" ? "6" : "16.5")}
            >
              <option value="16.5">16.5 BNB</option>
              <option value="6">6 BNB</option>
            </select>
          </div>
          <div>
            <div className="text-sm text-neutral-300">机制</div>
            <select
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              value={String(templateId)}
              onChange={(e) => setTemplateId((Number(e.target.value) === 1 ? 1 : 0) as 0 | 1)}
            >
              <option value="0">基础版（无税）</option>
              <option value="1">税费版（分红/销毁/回流）</option>
            </select>
          </div>
            {templateId === 1 ? (
              <div className="rounded-xl border border-neutral-800 p-3">
                <div className="text-sm font-medium text-neutral-200">税费参数</div>
                <div className="mt-3 grid gap-3">
                  <div>
                    <div className="text-xs text-neutral-400">税率（0.1%-5%）</div>
                    <input
                      className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                      value={taxRatePercent}
                      onChange={(e) => setTaxRatePercent(e.target.value)}
                      placeholder="例如：1.0"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-neutral-400">持币分红（%）</div>
                      <input
                        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                        value={holderSharePercent}
                        onChange={(e) => setHolderSharePercent(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-neutral-400">代币销毁（%）</div>
                      <input
                        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                        value={burnSharePercent}
                        onChange={(e) => setBurnSharePercent(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-neutral-400">回流（%）</div>
                      <input
                        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                        value={buybackSharePercent}
                        onChange={(e) => setBuybackSharePercent(e.target.value)}
                      />
                    </div>
                  </div>
                  {!taxConfig.ok ? <div className="text-sm text-red-400">{taxConfig.reason}</div> : null}
                </div>
              </div>
            ) : null}
          <button
            className="mt-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
            disabled={disabled}
            onClick={() =>
              writeContract(
                {
                  address: factory!,
                  abi: memeTokenFactoryAbi,
                  functionName: "createToken",
                  args: [
                    name.trim(),
                    symbol.trim(),
                    description.trim(),
                    logo.trim(),
                    telegram.trim(),
                    twitter.trim(),
                    website.trim(),
                    targetRaiseOption === "6" ? 6000000000000000000n : 16500000000000000000n,
                    taxConfig.ok ? taxConfig.templateId : 0,
                    taxConfig.ok ? taxConfig.taxBps : 0,
                    taxConfig.ok ? taxConfig.burnShareBps : 0,
                    taxConfig.ok ? taxConfig.holderShareBps : 0,
                    taxConfig.ok ? taxConfig.liquidityShareBps : 0,
                    taxConfig.ok ? taxConfig.buybackShareBps : 0
                  ],
                  value: creationFee as bigint
                },
                {
                  onSuccess: (hash) => {
                    void hash
                  }
                }
              )
            }
          >
            {isPending ? "提交中…" : isConfirming ? "确认中…" : "创建代币"}
          </button>

          {disabledReason && !isPending && !isConfirming ? (
            <div className="mt-2 text-sm text-neutral-400">{disabledReason}</div>
          ) : null}
          {error && <div className="text-sm text-red-400">{error.message}</div>}
        </div>
      </div>

        {txHash && (
          <TxWatcher
            txHash={txHash}
            onToken={(token) => {
              navigate(`/token/${token}`)
            }}
          />
        )}
    </div>
  )
}

function TxWatcher(props: { txHash: `0x${string}`; onToken: (token: `0x${string}`) => void }) {
  const chainId = useChainId()
  const factory = getFactoryAddress(chainId)
  const { data } = useWaitForTransactionReceipt({ hash: props.txHash })

  if (!data) return null

  try {
    const logs = parseEventLogs({
      abi: memeTokenFactoryAbi,
      logs: data.logs,
      eventName: "TokenCreated"
    })
    const token = logs[0]?.args?.token as `0x${string}` | undefined
    if (token) props.onToken(token)
  } catch {
    void 0
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
      已确认：{props.txHash}
      <div className="mt-1 text-xs text-neutral-500">Factory: {factory}</div>
    </div>
  )
}
