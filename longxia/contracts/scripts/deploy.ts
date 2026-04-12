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

  const isMainnet = chainId === 56n
  const treasury = process.env.TREASURY_ADDRESS || deployer.address
  const wbnb =
    process.env[isMainnet ? "WBNB_BSC" : "WBNB_BSC_TESTNET"] ||
    (isMainnet ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd")
  const router =
    process.env[isMainnet ? "PANCAKE_V2_ROUTER_BSC" : "PANCAKE_V2_ROUTER_BSC_TESTNET"] ||
    (isMainnet ? "0x10ED43C718714eb63d5aA57B78B54704E256024E" : "0x9ac64cc6e4415144c455bd8e4837fea55603e5c3")

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
