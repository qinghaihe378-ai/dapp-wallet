import { expect } from "chai"
import hre from "hardhat"

const { ethers } = hre

describe("MemeTokenFactory end-to-end", function () {
  it("creates token, trades on curve with fees, and migrates to V2 with locked liquidity", async function () {
    const [owner, treasury, creator, trader] = await ethers.getSigners()

    const MockWBNB = await ethers.getContractFactory("MockWBNB")
    const mockWbnb = await MockWBNB.deploy()
    await mockWbnb.waitForDeployment()

    const MockV2Factory = await ethers.getContractFactory("MockV2Factory")
    const mockV2Factory = await MockV2Factory.deploy()
    await mockV2Factory.waitForDeployment()

    const MockV2Router = await ethers.getContractFactory("MockV2Router")
    const mockV2Router = await MockV2Router.deploy(await mockV2Factory.getAddress(), await mockWbnb.getAddress())
    await mockV2Router.waitForDeployment()

    const TaxDeployer = await ethers.getContractFactory("TaxTokenDeployer")
    const taxDeployer = await TaxDeployer.deploy()
    await taxDeployer.waitForDeployment()

    const Factory = await ethers.getContractFactory("MemeTokenFactory")
    const factory = (await Factory.deploy(
      owner.address,
      treasury.address,
      await mockWbnb.getAddress(),
      await mockV2Router.getAddress(),
      await taxDeployer.getAddress()
    )) as any
    await factory.waitForDeployment()

    await (
      await factory
        .connect(owner)
        .setConfig(ethers.parseEther("0.005"), ethers.parseEther("2"), ethers.parseEther("1"), 100, 100, 10)
    ).wait()

    const fee = await factory.creationFee()
    const treasuryBefore = await ethers.provider.getBalance(treasury.address)

    const tx = await factory
      .connect(creator)
      .createToken("Flap Inu", "FLAP", "desc", "https://logo", "", "", "", 0, 0, 0, 0, 0, 0, 0, { value: fee })
    const rc = await tx.wait()
    expect(rc).to.not.equal(null)

    const treasuryAfter = await ethers.provider.getBalance(treasury.address)
    expect(treasuryAfter - treasuryBefore).to.eq(fee)

    const created = rc!.logs
      .map((l: any) => {
        try {
          return factory.interface.parseLog(l)
        } catch {
          return null
        }
      })
      .find((x: any) => x?.name === "TokenCreated")

    expect(created).to.not.equal(undefined)
    const tokenAddr = created!.args.token as string
    const marketAddr = created!.args.market as string

    const token = (await ethers.getContractAt("MemeToken", tokenAddr)) as any
    const market = (await ethers.getContractAt("BondingCurveMarket", marketAddr)) as any

    expect(await token.balanceOf(marketAddr)).to.eq(await token.totalSupply())

    const treasuryBeforeTrade = await ethers.provider.getBalance(treasury.address)
    await (await market.connect(trader).buy(trader.address, 0, { value: ethers.parseEther("1") })).wait()
    const traderTokens = await token.balanceOf(trader.address)
    expect(traderTokens).to.be.gt(0n)

    const treasuryAfterTrade = await ethers.provider.getBalance(treasury.address)
    expect(treasuryAfterTrade - treasuryBeforeTrade).to.eq(ethers.parseEther("0.01"))

    await (await token.connect(trader).approve(marketAddr, traderTokens)).wait()
    const marketBnbBeforeSell = await ethers.provider.getBalance(marketAddr)
    const sellTx = await market.connect(trader).sell(traderTokens / 2n, 0, trader.address)
    const sellRc = await sellTx.wait()
    expect(sellRc).to.not.equal(null)
    const marketBnbAfterSell = await ethers.provider.getBalance(marketAddr)
    expect(marketBnbAfterSell).to.be.lt(marketBnbBeforeSell)

    await (await market.connect(trader).buy(trader.address, 0, { value: ethers.parseEther("2") })).wait()
    expect(await market.migrated()).to.eq(true)

    const pair = await market.migratedPair()
    expect(pair).to.not.equal(ethers.ZeroAddress)

    const lockerAddr = await factory.locker()
    const locker = (await ethers.getContractAt("LiquidityLocker", lockerAddr)) as any
    const lockId = await market.migratedLockId()
    const lock = await locker.locks(lockId)
    expect(lock.beneficiary).to.eq(treasury.address)
    expect(lock.unlockTime).to.be.gt(0n)
    expect(lock.amount).to.be.gt(0n)

    expect(await token.tradingRestricted()).to.eq(true)
    expect(await token.tradingOpenTime()).to.be.gt(0n)
  })

  it("creates tax token template", async function () {
    const [owner, treasury, creator] = await ethers.getSigners()

    const MockWBNB = await ethers.getContractFactory("MockWBNB")
    const mockWbnb = await MockWBNB.deploy()
    await mockWbnb.waitForDeployment()

    const MockV2Factory = await ethers.getContractFactory("MockV2Factory")
    const mockV2Factory = await MockV2Factory.deploy()
    await mockV2Factory.waitForDeployment()

    const MockV2Router = await ethers.getContractFactory("MockV2Router")
    const mockV2Router = await MockV2Router.deploy(await mockV2Factory.getAddress(), await mockWbnb.getAddress())
    await mockV2Router.waitForDeployment()

    const TaxDeployer = await ethers.getContractFactory("TaxTokenDeployer")
    const taxDeployer = await TaxDeployer.deploy()
    await taxDeployer.waitForDeployment()

    const Factory = await ethers.getContractFactory("MemeTokenFactory")
    const factory = (await Factory.deploy(
      owner.address,
      treasury.address,
      await mockWbnb.getAddress(),
      await mockV2Router.getAddress(),
      await taxDeployer.getAddress()
    )) as any
    await factory.waitForDeployment()

    const fee = await factory.creationFee()

    const tx = await factory
      .connect(creator)
      .createToken("Tax Inu", "TAX", "desc", "logo", "", "", "", ethers.parseEther("6"), 1, 100, 2000, 4000, 2000, 2000, { value: fee })
    const rc = await tx.wait()
    expect(rc).to.not.equal(null)

    const created = rc!.logs
      .map((l: any) => {
        try {
          return factory.interface.parseLog(l)
        } catch {
          return null
        }
      })
      .find((x: any) => x?.name === "TokenCreated")

    expect(created).to.not.equal(undefined)
    const tokenAddr = created!.args.token as string
    const marketAddr = created!.args.market as string

    const token = (await ethers.getContractAt("MemeTokenTax", tokenAddr)) as any
    expect(await token.balanceOf(marketAddr)).to.eq(await token.totalSupply())

    const ti = await factory.tokenInfo(tokenAddr)
    expect(ti.templateId).to.eq(1n)
    expect(ti.taxBps).to.eq(100n)
  })
})
