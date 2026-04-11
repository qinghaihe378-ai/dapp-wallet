import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const sourcePath = path.join(root, 'contracts', 'SimpleERC20.sol')
const outPath = path.join(root, 'src', 'lib', 'evm', 'artifacts', 'simpleErc20.json')

const source = fs.readFileSync(sourcePath, 'utf8')
const input = {
  language: 'Solidity',
  sources: {
    'SimpleERC20.sol': { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = output.errors?.filter((e) => e.severity === 'error') ?? []
if (errors.length) {
  console.error(errors)
  process.exit(1)
}

const contract = output.contracts['SimpleERC20.sol'].SimpleERC20
const artifact = {
  contractName: 'SimpleERC20',
  abi: contract.abi,
  bytecode: '0x' + contract.evm.bytecode.object,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2))
console.log('Wrote', outPath)
