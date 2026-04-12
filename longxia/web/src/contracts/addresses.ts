import { bsc, bscTestnet } from "wagmi/chains"

export function getFactoryAddress(chainId: number): `0x${string}` | undefined {
  const bscAddr = import.meta.env.VITE_FACTORY_ADDRESS_BSC as string | undefined
  const testAddr = import.meta.env.VITE_FACTORY_ADDRESS_BSC_TESTNET as string | undefined

  if (chainId === bsc.id) {
    return bscAddr as `0x${string}` | undefined
  }
  if (chainId === bscTestnet.id) {
    return testAddr as `0x${string}` | undefined
  }
  return undefined
}
