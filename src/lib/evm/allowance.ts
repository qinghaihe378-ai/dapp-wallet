import { ethers } from 'ethers'
import { ERC20_ABI } from './abis'
import type { EvmToken } from './tokens'

export async function getAllowance(
  provider: ethers.Provider,
  token: EvmToken,
  owner: string,
  spender: string,
) {
  if (token.isNative) {
    return ethers.MaxUint256
  }

  const contract = new ethers.Contract(token.address, ERC20_ABI, provider)
  return await contract.allowance(owner, spender) as bigint
}

export async function ensureAllowance(
  signer: ethers.Signer,
  token: EvmToken,
  spender: string,
  amount: bigint,
  onBroadcast?: (hash: string) => void,
) {
  if (token.isNative) {
    return null
  }

  const owner = await signer.getAddress()
  const provider = signer.provider
  if (!provider) {
    throw new Error('钱包 provider 不存在。')
  }

  const current = await getAllowance(provider, token, owner, spender)
  if (current >= amount) {
    return null
  }

  const contract = new ethers.Contract(token.address, ERC20_ABI, signer)
  const tx = await contract.approve(spender, ethers.MaxUint256)
  onBroadcast?.(tx.hash)
  const receipt = await tx.wait()
  return receipt?.hash ?? tx.hash
}
