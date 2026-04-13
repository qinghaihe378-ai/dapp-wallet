import { config as dotenvConfig } from "dotenv"
import path from "path"
import { fileURLToPath } from "url"
import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenvConfig({ path: path.resolve(__dirname, "../.env") })

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY

const BSC_RPC_URL = process.env.BNB_RPC_URL ?? process.env.BSC_RPC_URL ?? process.env.BNB_MAINNET_RPC_URL
const BSC_TESTNET_RPC_URL = process.env.BNB_TESTNET_RPC_URL ?? process.env.BSC_TESTNET_RPC_URL

const networks: HardhatUserConfig["networks"] = {
  hardhat: { chainId: 31337 },
  localhost: {
    url: "http://127.0.0.1:8545",
    chainId: 31337
  }
}

if (BSC_RPC_URL) {
  networks.bsc = {
    url: BSC_RPC_URL,
    chainId: 56,
    accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : []
  }
}

if (BSC_TESTNET_RPC_URL) {
  networks.bscTestnet = {
    url: BSC_TESTNET_RPC_URL,
    chainId: 97,
    accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : []
  }
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 800 }
    }
  },
  networks,
  etherscan: {
    apiKey: process.env.BSCSCAN_API_KEY ?? ""
  }
}

export default config
