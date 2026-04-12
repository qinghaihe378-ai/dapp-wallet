import hre from "hardhat"
import fs from "node:fs/promises"
import path from "node:path"
 
const { ethers } = hre
 
async function main() {
  const [deployer] = await ethers.getSigners()
  const net = await deployer.provider!.getNetwork()
  const chainId = net.chainId
 
  const treasury = deployer.address
 
  const FactoryMock = await ethers.getContractFactory("MockV2Factory")
  const factoryMock = await FactoryMock.deploy()
  await factoryMock.waitForDeployment()
  const factoryMockAddress = await factoryMock.getAddress()
 
  const WBNB = await ethers.getContractFactory("MockWBNB")
  const wbnb = await WBNB.deploy()
  await wbnb.waitForDeployment()
  const wbnbAddress = await wbnb.getAddress()
 
  const Router = await ethers.getContractFactory("MockV2Router")
  const router = await Router.deploy(factoryMockAddress, wbnbAddress)
  await router.waitForDeployment()
  const routerAddress = await router.getAddress()
 
  const TaxDeployer = await ethers.getContractFactory("TaxTokenDeployer")
  const taxDeployer = await TaxDeployer.deploy()
  await taxDeployer.waitForDeployment()
  const taxDeployerAddress = await taxDeployer.getAddress()
 
  const MemeTokenFactory = await ethers.getContractFactory("MemeTokenFactory")
  const memeFactory = await MemeTokenFactory.deploy(
    deployer.address,
    treasury,
    wbnbAddress,
    routerAddress,
    taxDeployerAddress
  )
  await memeFactory.waitForDeployment()
  const memeFactoryAddress = await memeFactory.getAddress()
  const locker = await memeFactory.locker()
 
  const deploymentsDir = path.resolve(process.cwd(), "deployments")
  await fs.mkdir(deploymentsDir, { recursive: true })
  const deploymentPath = path.join(deploymentsDir, "local.json")
  await fs.writeFile(
    deploymentPath,
    JSON.stringify(
      {
        chainId: chainId.toString(),
        deployer: deployer.address,
        factory: memeFactoryAddress,
        locker,
        treasury,
        wbnb: wbnbAddress,
        router: routerAddress,
        taxDeployer: taxDeployerAddress,
        mockV2Factory: factoryMockAddress,
        deployedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  )
 
  console.log("chainId", chainId.toString())
  console.log("deployer", deployer.address)
  console.log("factory", memeFactoryAddress)
  console.log("locker", locker)
  console.log("treasury", treasury)
  console.log("wbnb", wbnbAddress)
  console.log("router", routerAddress)
  console.log("taxDeployer", taxDeployerAddress)
  console.log("mockV2Factory", factoryMockAddress)
  console.log("deployments", deploymentPath)
}
 
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
