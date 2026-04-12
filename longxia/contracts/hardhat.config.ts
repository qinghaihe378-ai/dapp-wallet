import { config as dotenvConfig } from "dotenv"
import path from "path"
import { fileURLToPath } from "url"
import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenvConfig({ path: path.resolve(__dirname, "../.env") })

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY

const networks: HardhatUserConfig["networks"] = {
  hardhat: { chainId: 31337 }
}

if (process.env.BNB_RPC_URL) {
  networks.bsc = {
    url: process.env.BNB_RPC_URL,
    chainId: 56,
    accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : []
  }
}

if (process.env.BNB_TESTNET_RPC_URL) {
  networks.bscTestnet = {
    url: process.env.BNB_TESTNET_RPC_URL,
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
