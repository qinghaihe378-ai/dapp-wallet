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

function envStr(name: string, fallback: string): string {
  const v = process.env[name]
  return v ? v : fallback
}

async function main() {
  const [signer] = await hre.ethers.getSigners()
  const factoryAddress = await readFactoryAddress()
  const factory = await hre.ethers.getContractAt("MemeTokenFactory", factoryAddress)
  const fee = await factory.creationFee()

  const name = envStr("TOKEN_NAME", "Lobster Test")
  const symbol = envStr("TOKEN_SYMBOL", "LOBTEST")
  const description = envStr("TOKEN_DESCRIPTION", "test")
  const logo = envStr("TOKEN_LOGO", "")
  const telegram = envStr("TOKEN_TELEGRAM", "")
  const twitter = envStr("TOKEN_TWITTER", "")
  const website = envStr("TOKEN_WEBSITE", "")

  const targetRaiseOverride = hre.ethers.parseEther(envStr("TARGET_RAISE", "6"))
  const templateId = Number(envStr("TEMPLATE_ID", "0"))

  const taxBps = Number(envStr("TAX_BPS", "0"))
  const burnShareBps = Number(envStr("BURN_SHARE_BPS", "0"))
  const holderShareBps = Number(envStr("HOLDER_SHARE_BPS", "0"))
  const liquidityShareBps = Number(envStr("LIQUIDITY_SHARE_BPS", "0"))
  const buybackShareBps = Number(envStr("BUYBACK_SHARE_BPS", "0"))

  console.log("signer", signer.address)
  console.log("factory", factoryAddress)
  console.log("creationFee", fee.toString())

  const tx = await factory.createToken(
    name,
    symbol,
    description,
    logo,
    telegram,
    twitter,
    website,
    targetRaiseOverride,
    templateId,
    taxBps,
    burnShareBps,
    holderShareBps,
    liquidityShareBps,
    buybackShareBps,
    { value: fee }
  )

  console.log("tx", tx.hash)
  const rc = await tx.wait()
  if (!rc) throw new Error("Missing receipt")

  const parsed = rc.logs
    .map((l) => {
      try {
        return factory.interface.parseLog(l)
      } catch {
        return null
      }
    })
    .find((x) => x?.name === "TokenCreated")

  const token = (parsed?.args?.token as string | undefined) ?? ""
  const market = (parsed?.args?.market as string | undefined) ?? ""

  console.log("token", token)
  console.log("market", market)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

