import { bsc, bscTestnet } from "wagmi/chains"
import bscDeployment from "../../../contracts/deployments/bsc.json"
import bscTestnetDeployment from "../../../contracts/deployments/bscTestnet.json"

export function getFactoryAddress(chainId: number): `0x${string}` | undefined {
  const bscAddr = import.meta.env.VITE_FACTORY_ADDRESS_BSC as string | undefined
  const testAddr = import.meta.env.VITE_FACTORY_ADDRESS_BSC_TESTNET as string | undefined

  if (chainId === bsc.id) {
    const fallback = (bscDeployment as { factory?: string } | undefined)?.factory
    return (bscAddr || fallback) as `0x${string}` | undefined
  }
  if (chainId === bscTestnet.id) {
    const fallback = (bscTestnetDeployment as { factory?: string } | undefined)?.factory
    return (testAddr || fallback) as `0x${string}` | undefined
  }
  if (chainId === 31337) {
    return testAddr as `0x${string}` | undefined
  }
  return undefined
}
