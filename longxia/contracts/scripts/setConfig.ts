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

async function main() {
  const [signer] = await hre.ethers.getSigners()
  const factoryAddress = await readFactoryAddress()
  const factory = await hre.ethers.getContractAt("MemeTokenFactory", factoryAddress)

  const creationFee = await factory.creationFee()
  const targetRaise = await factory.targetRaise()
  const buyFeeBps = await factory.buyFeeBps()
  const sellFeeBps = await factory.sellFeeBps()
  const antiSnipingDelaySeconds = await factory.antiSnipingDelaySeconds()

  const desiredInitialPrice = process.env.INITIAL_PRICE_BNB_PER_TOKEN ?? "0.00000378"
  const saleSupplyTokens = 800_000_000n
  const priceWei = hre.ethers.parseEther(desiredInitialPrice)
  const virtualBnbReserve = priceWei * saleSupplyTokens

  console.log("signer", signer.address)
  console.log("factory", factoryAddress)
  console.log("desiredInitialPrice", desiredInitialPrice, "BNB/token")
  console.log("saleSupplyTokens", saleSupplyTokens.toString())
  console.log("virtualBnbReserve(BNB)", hre.ethers.formatEther(virtualBnbReserve))

  const tx = await factory.setConfig(
    creationFee,
    targetRaise,
    virtualBnbReserve,
    buyFeeBps,
    sellFeeBps,
    antiSnipingDelaySeconds
  )
  console.log("tx", tx.hash)
  await tx.wait()
  console.log("done")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

