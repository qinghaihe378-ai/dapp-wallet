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

function envBigInt(name: string, fallback: string): bigint {
  const v = process.env[name]
  return BigInt(v ? v : fallback)
}

async function main() {
  const [signer] = await hre.ethers.getSigners()
  const slippageBps = envBigInt("SLIPPAGE_BPS", "500")

  console.log("signer", signer.address)
  const factoriesEnv = process.env.FACTORY_ADDRESSES?.trim()
  const factoryAddresses = factoriesEnv
    ? factoriesEnv.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [await readFactoryAddress()]
  console.log("factories", factoryAddresses.join(","))

  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
  ]

  for (const factoryAddress of factoryAddresses) {
    const factory = await hre.ethers.getContractAt("MemeTokenFactory", factoryAddress)
    const len = await factory.allTokensLength()
    console.log("factory", factoryAddress)
    console.log("tokensCount", len.toString())

    for (let i = 0n; i < len; i++) {
      const tokenAddress = await factory.allTokens(i)
      const info = await factory.tokenInfo(tokenAddress)
      const marketAddress = info.market as string

      const token = new hre.ethers.Contract(tokenAddress, erc20Abi, signer)
      const bal = (await token.balanceOf(signer.address)) as bigint
      if (bal === 0n) continue

      const market = await hre.ethers.getContractAt("BondingCurveMarket", marketAddress)
      const migrated = await market.migrated()
      if (migrated) {
        console.log("skipMigrated", tokenAddress, marketAddress, bal.toString())
        continue
      }

      const [bnbOut, feePaid] = await market.quoteSell(bal)
      const minBnbOut = (bnbOut * (10_000n - slippageBps)) / 10_000n

      console.log("sell", tokenAddress, marketAddress)
      console.log("tokensIn", bal.toString())
      console.log("quoteBnbOut", bnbOut.toString())
      console.log("feePaid", feePaid.toString())
      console.log("minBnbOut", minBnbOut.toString())

      const allowance = (await token.allowance(signer.address, marketAddress)) as bigint
      if (allowance < bal) {
        const approveTx = await token.approve(marketAddress, hre.ethers.MaxUint256)
        console.log("approveTx", approveTx.hash)
        await approveTx.wait()
      }

      const tx = await market.sell(bal, minBnbOut, signer.address)
      console.log("tx", tx.hash)
      await tx.wait()
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
