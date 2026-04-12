import hre from "hardhat"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const txHash = requireEnv("TX_HASH")
  const rc = await hre.ethers.provider.getTransactionReceipt(txHash)
  if (!rc) throw new Error("Missing receipt")

  const erc20Iface = new hre.ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"])

  const transfers: { address: string; from: string; to: string; value: bigint }[] = []
  for (const l of rc.logs) {
    try {
      const p = erc20Iface.parseLog({ topics: l.topics as string[], data: l.data as string })
      const from = p.args.from as string
      const to = p.args.to as string
      const value = p.args.value as bigint
      transfers.push({ address: l.address, from, to, value })
    } catch {
      continue
    }
  }

  console.log("tx", txHash)
  console.log("status", rc.status)
  console.log("blockNumber", rc.blockNumber)
  console.log("transferLogs", transfers.length)
  for (const t of transfers) {
    console.log("Transfer", t.address, t.from, "->", t.to, t.value.toString())
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

