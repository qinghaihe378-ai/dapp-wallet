import hre from "hardhat"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const [signer] = await hre.ethers.getSigners()
  const marketAddress = requireEnv("MARKET_ADDRESS")
  const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? "500")

  const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)
  const tokenAddress = await market.token()
  const token = await hre.ethers.getContractAt("MemeToken", tokenAddress)

  const bal = await token.balanceOf(signer.address)
  if (bal === 0n) throw new Error("Token balance is 0")

  const quote = await market.quoteSell(bal)
  const bnbOut = quote[0] as bigint
  const feePaid = quote[1] as bigint
  const minBnbOut = (bnbOut * (10_000n - slippageBps)) / 10_000n

  console.log("signer", signer.address)
  console.log("market", marketAddress)
  console.log("token", tokenAddress)
  console.log("tokensIn", bal.toString())
  console.log("quoteBnbOut", bnbOut.toString())
  console.log("feePaid", feePaid.toString())
  console.log("minBnbOut", minBnbOut.toString())

  const allowance = await token.allowance(signer.address, marketAddress)
  if (allowance < bal) {
    const approveTx = await token.approve(marketAddress, hre.ethers.MaxUint256)
    console.log("approveTx", approveTx.hash)
    await approveTx.wait()
  }

  const tx = await market.sell(bal, minBnbOut, signer.address)
  console.log("tx", tx.hash)
  const rc = await tx.wait()
  if (!rc) throw new Error("Missing receipt")

  const marketIface = market.interface
  const parsed = rc.logs
    .map((l) => {
      try {
        return marketIface.parseLog(l)
      } catch {
        return null
      }
    })
    .find((x) => x?.name === "Sell")

  if (parsed) {
    console.log("sellEvent.tokensIn", (parsed.args.tokensIn as bigint).toString())
    console.log("sellEvent.bnbOut", (parsed.args.bnbOut as bigint).toString())
    console.log("sellEvent.feePaid", (parsed.args.feePaid as bigint).toString())
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

