import { ethers } from 'ethers'
import artifact from '../evm/artifacts/simpleErc20.json'

export type DeploySimpleErc20Params = {
  name: string
  symbol: string
  /** 人类可读总枚数，18 位小数，如 "1000000" */
  totalSupplyHuman: string
}

export async function deploySimpleERC20(
  signer: ethers.Signer,
  params: DeploySimpleErc20Params,
): Promise<{ contractAddress: string; txHash: string }> {
  const raw = params.totalSupplyHuman.trim().replace(/_/g, '')
  if (/[eE]/.test(raw)) {
    throw new Error('总量请用普通数字（不要用科学计数法），例如 1000000')
  }
  let supplyWei: bigint
  try {
    supplyWei = ethers.parseUnits(raw, 18)
  } catch {
    throw new Error('总量格式无效，请使用数字，可含小数点')
  }
  if (supplyWei <= 0n) {
    throw new Error('总量必须大于 0')
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer)
  const contract = await factory.deploy(params.name, params.symbol, supplyWei)
  const dtx = contract.deploymentTransaction()
  const txHash = dtx?.hash
  if (!txHash) {
    throw new Error('未拿到部署交易哈希')
  }
  await contract.waitForDeployment()
  const contractAddress = await contract.getAddress()
  return { contractAddress, txHash }
}
