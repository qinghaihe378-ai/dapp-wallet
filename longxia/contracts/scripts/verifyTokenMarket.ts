import hre from "hardhat"
import fs from "node:fs/promises"
import path from "node:path"

function requireTokenAddress(): string {
  const a = process.env.TOKEN_ADDRESS
  if (!a) throw new Error("Missing env TOKEN_ADDRESS")
  return a
}

async function readFactoryAddress(): Promise<string | undefined> {
  const net = await hre.ethers.provider.getNetwork()
  const file = net.chainId === 56n ? "bsc.json" : "bscTestnet.json"
  const p = path.resolve(process.cwd(), "deployments", file)
  try {
    const raw = await fs.readFile(p, "utf8")
    const d = JSON.parse(raw) as { factory: string }
    return d.factory
  } catch {
    return undefined
  }
}

async function main() {
  const tokenAddress = requireTokenAddress()
  const factoryFromDeploy = await readFactoryAddress()

  const token = await hre.ethers.getContractAt("MemeToken", tokenAddress)
  const name = await token.name()
  const symbol = await token.symbol()
  const totalSupply = await token.totalSupply()
  const factory = factoryFromDeploy ?? (await token.factory())

  const factoryContract = await hre.ethers.getContractAt("MemeTokenFactory", factory)
  const ti = await factoryContract.tokenInfo(tokenAddress)
  const marketAddress = ti.market
  const creator = ti.creator
  const locker = await factoryContract.locker()
  const treasury = await factoryContract.treasury()
  const wbnb = await factoryContract.wbnb()
  const router = await factoryContract.router()

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
      constructorArguments: [name, symbol, totalSupply, factory, factory]
    })
  } else if (ti.templateId === 1n) {
    await hre.run("verify:verify", {
      address: tokenAddress,
      constructorArguments: [
        name,
        symbol,
        totalSupply,
        factory,
        factory,
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

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
