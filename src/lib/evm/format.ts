import { ethers } from 'ethers'

export function formatDisplayAmount(value: bigint, decimals: number, precision = 6) {
  const numeric = Number(ethers.formatUnits(value, decimals))
  if (!Number.isFinite(numeric)) return '0'
  if (numeric === 0) return '0'
  if (numeric >= 1) return numeric.toFixed(Math.min(precision, 4))
  return numeric.toFixed(Math.min(precision, 6))
}

export function formatUsd(value: number) {
  if (!Number.isFinite(value)) return '0.00'
  return value.toFixed(value >= 1 ? 2 : 6)
}

export function encodeV3Path(addresses: string[], fees: number[]) {
  const packed: Array<string | number> = [addresses[0]]
  for (let index = 0; index < fees.length; index += 1) {
    packed.push(fees[index], addresses[index + 1])
  }
  const types = ['address', ...fees.flatMap(() => ['uint24', 'address'])]
  return ethers.solidityPacked(types, packed)
}
