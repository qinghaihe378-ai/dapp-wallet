import hre from "hardhat"

function reqEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const marketAddress = reqEnv("MARKET_ADDRESS")
  const bnbIn = hre.ethers.parseEther(reqEnv("BNB_IN"))

  const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)
  const [tokensOut, feePaid] = await market.quoteBuy(bnbIn)
  const saleSupply = await market.saleSupply()
  const circulating = await market.circulatingSupply()
  const targetRaise = await market.targetRaise()

  const soldAfter = circulating + tokensOut
  const pctWad = saleSupply === 0n ? 0n : (soldAfter * 10000n) / saleSupply

  console.log("market", marketAddress)
  console.log("bnbIn", bnbIn.toString())
  console.log("tokensOut", tokensOut.toString())
  console.log("feePaid", feePaid.toString())
  console.log("circulatingBefore", circulating.toString())
  console.log("circulatingAfter", soldAfter.toString())
  console.log("saleSupply", saleSupply.toString())
  console.log("soldPctBpsAfter", pctWad.toString())
  console.log("targetRaise", targetRaise.toString())
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

