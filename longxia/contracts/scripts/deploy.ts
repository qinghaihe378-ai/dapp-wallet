import hre from "hardhat"
import fs from "node:fs/promises"
import path from "node:path"

const { ethers } = hre

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const [deployer] = await ethers.getSigners()

  const net = await deployer.provider!.getNetwork()
  const chainId = net.chainId

  const treasury = requireEnv("TREASURY_ADDRESS")
  const wbnb = requireEnv(chainId === 56n ? "WBNB_BSC" : "WBNB_BSC_TESTNET")
  const router = requireEnv(chainId === 56n ? "PANCAKE_V2_ROUTER_BSC" : "PANCAKE_V2_ROUTER_BSC_TESTNET")

  const TaxDeployer = await ethers.getContractFactory("TaxTokenDeployer")
  const taxDeployer = await TaxDeployer.deploy()
  await taxDeployer.waitForDeployment()
  const taxDeployerAddress = await taxDeployer.getAddress()

  const Factory = await ethers.getContractFactory("MemeTokenFactory")
  const factory = await Factory.deploy(deployer.address, treasury, wbnb, router, taxDeployerAddress)
  await factory.waitForDeployment()

  const factoryAddress = await factory.getAddress()
  const locker = await factory.locker()

  const deploymentsDir = path.resolve(process.cwd(), "deployments")
  await fs.mkdir(deploymentsDir, { recursive: true })
  const deploymentPath = path.join(deploymentsDir, chainId === 56n ? "bsc.json" : "bscTestnet.json")
  await fs.writeFile(
    deploymentPath,
    JSON.stringify(
      {
        chainId: chainId.toString(),
        deployer: deployer.address,
        factory: factoryAddress,
        locker,
        treasury,
        wbnb,
        router,
        taxDeployer: taxDeployerAddress,
        deployedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  )

  console.log("deployer", deployer.address)
  console.log("factory", factoryAddress)
  console.log("locker", locker)
  console.log("treasury", treasury)
  console.log("wbnb", wbnb)
  console.log("router", router)
  console.log("taxDeployer", taxDeployerAddress)
  console.log("deployments", deploymentPath)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
