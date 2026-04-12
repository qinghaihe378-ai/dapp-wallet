import fs from "node:fs/promises"
import path from "node:path"

const buildInfoDir = path.resolve(process.cwd(), "artifacts", "build-info")
const outDir = path.resolve(process.cwd(), "verify-input")

async function loadJson(p) {
  const raw = await fs.readFile(p, "utf8")
  return JSON.parse(raw)
}

async function findBuildInfo(contractPath, contractName) {
  const files = await fs.readdir(buildInfoDir)
  for (const f of files) {
    if (!f.endsWith(".json")) continue
    const p = path.join(buildInfoDir, f)
    const j = await loadJson(p)
    const out = j.output?.contracts?.[contractPath]?.[contractName]
    if (out?.abi) return { file: p, json: j }
  }
  throw new Error(`build-info not found for ${contractPath}:${contractName}`)
}

async function exportInput(contractPath, contractName, outFile) {
  const { file, json } = await findBuildInfo(contractPath, contractName)
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(json.input, null, 2), "utf8")
  console.log("exported", outFile)
  console.log("from", file)
}

await exportInput(
  "contracts/MemeTokenFactory.sol",
  "MemeTokenFactory",
  path.join(outDir, "MemeTokenFactory.input.json")
)
await exportInput(
  "contracts/LiquidityLocker.sol",
  "LiquidityLocker",
  path.join(outDir, "LiquidityLocker.input.json")
)
await exportInput(
  "contracts/TaxTokenDeployer.sol",
  "TaxTokenDeployer",
  path.join(outDir, "TaxTokenDeployer.input.json")
)
await exportInput(
  "contracts/MemeTokenTax.sol",
  "MemeTokenTax",
  path.join(outDir, "MemeTokenTax.input.json")
)
