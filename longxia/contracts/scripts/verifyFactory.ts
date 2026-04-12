import hre from "hardhat"
import fs from "node:fs/promises"
import path from "node:path"

type Deployment = {
  chainId: string
  deployer: string
  factory: string
  locker: string
  treasury: string
  wbnb: string
  router: string
  taxDeployer?: string
}

async function readDeployment(): Promise<Deployment> {
  const net = await hre.ethers.provider.getNetwork()
  const file = net.chainId === 56n ? "bsc.json" : "bscTestnet.json"
  const p = path.resolve(process.cwd(), "deployments", file)
  const raw = await fs.readFile(p, "utf8")
  return JSON.parse(raw) as Deployment
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function verifyWithRetry(args: { address: string; constructorArguments: unknown[] }, label: string) {
  let lastErr: unknown
  for (let i = 0; i < 6; i++) {
    try {
      await hre.run("verify:verify", args)
      return
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      const retryable =
        msg.includes("Connect Timeout") ||
        msg.includes("Network request failed") ||
        msg.includes("NetworkRequestError") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT")
      if (!retryable || i === 5) break
      console.log(`verify retry ${label} ${i + 1}/5`)
      await sleep(5000 * (i + 1))
    }
  }
  throw lastErr
}

async function main() {
  const d = await readDeployment()
  if (!d.taxDeployer) throw new Error("Missing taxDeployer in deployments file")

  await verifyWithRetry(
    {
      address: d.taxDeployer,
      constructorArguments: []
    },
    "taxDeployer"
  )

  await verifyWithRetry(
    {
    address: d.factory,
    constructorArguments: [d.deployer, d.treasury, d.wbnb, d.router, d.taxDeployer]
    },
    "factory"
  )

  await verifyWithRetry(
    {
    address: d.locker,
    constructorArguments: [d.factory]
    },
    "locker"
  )

  console.log("verified factory", d.factory)
  console.log("verified locker", d.locker)
  console.log("verified taxDeployer", d.taxDeployer)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
