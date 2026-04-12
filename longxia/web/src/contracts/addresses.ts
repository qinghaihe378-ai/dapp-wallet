import { bsc } from "wagmi/chains"
import bscDeployment from "../../../contracts/deployments/bsc.json"

export function getFactoryAddress(chainId: number): `0x${string}` | undefined {
  const bscAddr = import.meta.env.VITE_FACTORY_ADDRESS_BSC as string | undefined

  if (chainId === bsc.id) {
    const fallback = (bscDeployment as { factory?: string } | undefined)?.factory
    return (bscAddr || fallback) as `0x${string}` | undefined
  }
  return undefined
}
