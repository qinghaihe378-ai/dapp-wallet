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
  try {
    const tx = await contract.approve(spender, ethers.MaxUint256)
    onBroadcast?.(tx.hash)
    const receipt = await tx.wait()
    return receipt?.hash ?? tx.hash
  } catch (err) {
    // 一些 ERC20（常见于 BSC）要求先把 allowance 归零后才能重新授权
    if (current > 0n) {
      const resetTx = await contract.approve(spender, 0)
      onBroadcast?.(resetTx.hash)
      await resetTx.wait()
      const tx = await contract.approve(spender, ethers.MaxUint256)
      onBroadcast?.(tx.hash)
      const receipt = await tx.wait()
      return receipt?.hash ?? tx.hash
    }
    throw err
  }
}
