import hre from "hardhat"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const [signer] = await hre.ethers.getSigners()
  const marketAddress = requireEnv("MARKET_ADDRESS")
  const bnbIn = hre.ethers.parseEther(process.env.BNB_IN ?? "0.001")

  const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)
  const tokenAddress = await market.token()
  const token = await hre.ethers.getContractAt("MemeToken", tokenAddress)

  const quote = await market.quoteBuy(bnbIn)
  const tokensOut = quote[0]
  const feePaid = quote[1]

  console.log("signer", signer.address)
  console.log("market", marketAddress)
  console.log("token", tokenAddress)
  console.log("bnbIn", bnbIn.toString())
  console.log("feePaid", feePaid.toString())
  console.log("quoteTokensOut", tokensOut.toString())

  const tx = await market.buy(signer.address, 0, { value: bnbIn })
  console.log("tx", tx.hash)
  const rc = await tx.wait()
  if (!rc) throw new Error("Missing receipt")

  const erc20Iface = new hre.ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"])
  let received = 0n
  for (const l of rc.logs) {
    if (l.address.toLowerCase() !== tokenAddress.toLowerCase()) continue
    try {
      const p = erc20Iface.parseLog({ topics: l.topics as string[], data: l.data as string })
      if ((p.args.to as string).toLowerCase() === signer.address.toLowerCase()) {
        received += p.args.value as bigint
      }
    } catch {
      continue
    }
  }
  console.log("tokensReceived", received.toString())
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
