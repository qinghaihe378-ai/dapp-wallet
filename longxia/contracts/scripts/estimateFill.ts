import hre from "hardhat"

function reqEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

async function main() {
  const marketAddress = reqEnv("MARKET_ADDRESS")
  const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)

  const targetRaise = await market.targetRaise()
  const buyFeeBps = await market.buyFeeBps()
  const saleSupply = await market.saleSupply()
  const circulating = await market.circulatingSupply()

  const reserve = await hre.ethers.provider.getBalance(marketAddress)
  const netNeeded = reserve >= targetRaise ? 0n : targetRaise - reserve
  const denom = 10_000n - buyFeeBps
  const grossNeeded = denom === 0n ? 0n : ceilDiv(netNeeded * 10_000n, denom)

  console.log("market", marketAddress)
  console.log("reserveBNBWei", reserve.toString())
  console.log("targetRaiseWei", targetRaise.toString())
  console.log("buyFeeBps", buyFeeBps.toString())
  console.log("saleSupply", saleSupply.toString())
  console.log("circulating", circulating.toString())
  console.log("netNeededWei", netNeeded.toString())
  console.log("grossNeededWei", grossNeeded.toString())
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

