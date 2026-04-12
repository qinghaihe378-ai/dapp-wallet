import hre from "hardhat"
import fs from "node:fs/promises"
import path from "node:path"

type Deployment = {
  factory: string
}

async function readFactoryAddress(): Promise<string> {
  const net = await hre.ethers.provider.getNetwork()
  const file = net.chainId === 56n ? "bsc.json" : "bscTestnet.json"
  const p = path.resolve(process.cwd(), "deployments", file)
  const raw = await fs.readFile(p, "utf8")
  const d = JSON.parse(raw) as Deployment
  if (!d.factory) throw new Error("Missing factory in deployments file")
  return d.factory
}

async function verifyTokenMarket(tokenAddress: string) {
  const token = await hre.ethers.getContractAt("MemeToken", tokenAddress)
  const name = await token.name()
  const symbol = await token.symbol()
  const totalSupply = await token.totalSupply()
  const factoryAddress = await token.factory()

  const factory = await hre.ethers.getContractAt("MemeTokenFactory", factoryAddress)
  const ti = await factory.tokenInfo(tokenAddress)
  const marketAddress = ti.market
  const creator = ti.creator
  const locker = await factory.locker()
  const treasury = await factory.treasury()
  const wbnb = await factory.wbnb()
  const router = await factory.router()

  const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)
  const targetRaise = await market.targetRaise()
  const buyFeeBps = await market.buyFeeBps()
  const sellFeeBps = await market.sellFeeBps()
  const curveR = await market.curveR()
  const liquidityTokenReserve = await market.liquidityTokenReserve()
  const antiSnipingDelaySeconds = await market.antiSnipingDelaySeconds()

  if (ti.templateId === 0n) {
    await hre.run("verify:verify", {
      address: tokenAddress,
      constructorArguments: [name, symbol, totalSupply, factoryAddress, factoryAddress]
    })
  } else if (ti.templateId === 1n) {
    await hre.run("verify:verify", {
      address: tokenAddress,
      constructorArguments: [
        name,
        symbol,
        totalSupply,
        factoryAddress,
        factoryAddress,
        treasury,
        wbnb,
        router,
        ti.taxBps,
        ti.burnShareBps,
        ti.holderShareBps,
        ti.liquidityShareBps,
        ti.buybackShareBps
      ]
    })
  } else {
    throw new Error(`Unknown templateId: ${String(ti.templateId)}`)
  }

  await hre.run("verify:verify", {
    address: marketAddress,
    constructorArguments: [
      tokenAddress,
      creator,
      treasury,
      targetRaise,
      buyFeeBps,
      sellFeeBps,
      curveR,
      liquidityTokenReserve,
      antiSnipingDelaySeconds,
      wbnb,
      router,
      locker
    ]
  })

  console.log("verified token", tokenAddress)
  console.log("verified market", marketAddress)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("limit exceeded") || msg.includes("Too Many Requests") || msg.includes("429")
}

async function main() {
  const factoryAddress = await readFactoryAddress()
  const factory = await hre.ethers.getContractAt("MemeTokenFactory", factoryAddress)

  console.log("watching TokenCreated on", factoryAddress)

  const seen = new Set<string>()
  let chunkSize = 2000
  let fromBlock = await hre.ethers.provider.getBlockNumber()

  while (true) {
    const latest = await hre.ethers.provider.getBlockNumber()
    if (fromBlock > latest) {
      await sleep(5000)
      continue
    }

    const toBlock = Math.min(fromBlock + chunkSize, latest)

    try {
      const logs = await factory.queryFilter(factory.filters.TokenCreated(), fromBlock, toBlock)
      for (const l of logs) {
        const token = (l.args?.token as string | undefined) ?? ""
        const market = (l.args?.market as string | undefined) ?? ""
        const creator = (l.args?.creator as string | undefined) ?? ""
        if (!token || seen.has(token)) continue
        seen.add(token)
        console.log("TokenCreated", { token, market, creator })
        await sleep(15_000)
        await verifyTokenMarket(token)
      }

      fromBlock = toBlock + 1
      chunkSize = Math.min(10_000, Math.floor(chunkSize * 1.25) + 1)
    } catch (e) {
      if (!isRateLimit(e)) throw e
      chunkSize = Math.max(50, Math.floor(chunkSize / 2))
      await sleep(5000)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
