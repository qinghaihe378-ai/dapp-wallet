import { JsonRpcProvider } from 'ethers'
import { NETWORK_CONFIG, type Network } from '../walletConfig'

type FastRpcNetwork = Extract<Network, 'mainnet' | 'bsc' | 'base'>

type JsonRpcPayload = {
  id: number
  jsonrpc: '2.0'
  method: string
  params: Array<any> | Record<string, any>
}

type JsonRpcSuccess = {
  id: number
  result: unknown
}

type JsonRpcFailure = {
  id: number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

interface RpcNodeState {
  url: string
  latency: number
  successCount: number
  failureCount: number
}

interface CacheEntry {
  expiresAt: number
  promise: Promise<unknown>
}

interface ChainState {
  network: FastRpcNetwork
  nodes: RpcNodeState[]
  benchmarkPromise: Promise<void> | null
}

const REQUEST_TIMEOUT_MS = 2_000
const CACHE_TTL_MS = 3_000
const RACE_FANOUT = 3

const FAST_RPC_NETWORKS: FastRpcNetwork[] = ['mainnet', 'bsc', 'base']

const READ_CACHE = new Map<string, CacheEntry>()

const CHAIN_STATES = new Map<FastRpcNetwork, ChainState>(
  FAST_RPC_NETWORKS.map((network) => [
    network,
    {
      network,
      nodes: NETWORK_CONFIG[network].rpcUrls.map((url) => ({
        url,
        latency: Number.POSITIVE_INFINITY,
        successCount: 0,
        failureCount: 0,
      })),
      benchmarkPromise: null,
    },
  ]),
)

class RpcResponseError extends Error {
  response: JsonRpcFailure

  constructor(response: JsonRpcFailure) {
    super(response.error.message || 'RPC request failed')
    this.name = 'RpcResponseError'
    this.response = response
  }
}

function isFastRpcNetwork(network: Network): network is FastRpcNetwork {
  return FAST_RPC_NETWORKS.includes(network as FastRpcNetwork)
}

function sortNodes(nodes: RpcNodeState[]) {
  nodes.sort((left, right) => {
    const leftLatency = Number.isFinite(left.latency) ? left.latency : Number.MAX_SAFE_INTEGER
    const rightLatency = Number.isFinite(right.latency) ? right.latency : Number.MAX_SAFE_INTEGER
    if (leftLatency !== rightLatency) return leftLatency - rightLatency
    if (left.failureCount !== right.failureCount) return left.failureCount - right.failureCount
    if (left.successCount !== right.successCount) return right.successCount - left.successCount
    return left.url.localeCompare(right.url)
  })
}

function getChainState(network: FastRpcNetwork) {
  const state = CHAIN_STATES.get(network)
  if (!state) {
    throw new Error(`Unsupported RPC network: ${network}`)
  }
  return state
}

function updateNodeSuccess(state: ChainState, url: string, latencyMs: number) {
  const node = state.nodes.find((item) => item.url === url)
  if (!node) return
  node.successCount += 1
  node.latency = Number.isFinite(node.latency)
    ? Math.round(node.latency * 0.7 + latencyMs * 0.3)
    : Math.round(latencyMs)
  sortNodes(state.nodes)
}

function updateNodeFailure(state: ChainState, url: string) {
  const node = state.nodes.find((item) => item.url === url)
  if (!node) return
  node.failureCount += 1
  if (Number.isFinite(node.latency)) {
    node.latency += 250
  }
  sortNodes(state.nodes)
}

function makeCacheKey(network: FastRpcNetwork, method: string, params: Array<any> | Record<string, any>) {
  return `${network}:${method}:${JSON.stringify(params)}`
}

function isCacheableMethod(method: string) {
  return !/^eth_send|^personal_|^wallet_|^debug_|^trace_|^engine_|^admin_|^miner_|^txpool_/i.test(method)
}

function buildSuccessResponse(id: number | string, result: unknown): JsonRpcSuccess {
  return { id: Number(id), result }
}

function buildErrorResponse(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    id: Number(id),
    error: { code, message, data },
  }
}

async function fetchJsonRpc(
  url: string,
  payload: JsonRpcPayload,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<JsonRpcResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json() as JsonRpcResponse
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON-RPC response')
    }

    if (!('result' in data) && !('error' in data)) {
      throw new Error('Malformed JSON-RPC payload')
    }

    return data
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function benchmarkNode(state: ChainState, node: RpcNodeState) {
  const start = performance.now()
  try {
    await fetchJsonRpc(
      node.url,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      },
      REQUEST_TIMEOUT_MS,
    )
    updateNodeSuccess(state, node.url, performance.now() - start)
  } catch {
    updateNodeFailure(state, node.url)
  }
}

async function benchmarkNetwork(network: FastRpcNetwork) {
  const state = getChainState(network)
  if (state.benchmarkPromise) return state.benchmarkPromise

  state.benchmarkPromise = Promise.all(state.nodes.map((node) => benchmarkNode(state, node)))
    .then(() => {
      sortNodes(state.nodes)
    })
    .finally(() => {
      state.benchmarkPromise = null
    })

  return state.benchmarkPromise
}

function getRaceNodes(network: FastRpcNetwork) {
  const state = getChainState(network)
  sortNodes(state.nodes)
  return state.nodes.slice(0, Math.min(RACE_FANOUT, state.nodes.length))
}

async function racePayload(network: FastRpcNetwork, payload: JsonRpcPayload): Promise<JsonRpcResponse> {
  const state = getChainState(network)
  const candidates = getRaceNodes(network)

  if (candidates.length === 0) {
    return buildErrorResponse(payload.id, -32000, `No RPC nodes configured for ${network}`)
  }

  return await new Promise<JsonRpcResponse>((resolve) => {
    let settled = false
    let finished = 0
    let firstFailure: JsonRpcFailure | null = null
    const controllers = candidates.map(() => new AbortController())

    const settle = (response: JsonRpcResponse) => {
      if (settled) return
      settled = true
      controllers.forEach((controller) => controller.abort())
      resolve(response)
    }

    candidates.forEach((node, index) => {
      const startedAt = performance.now()
      fetchJsonRpc(node.url, payload, REQUEST_TIMEOUT_MS, controllers[index].signal)
        .then((response) => {
          updateNodeSuccess(state, node.url, performance.now() - startedAt)
          settle(response)
        })
        .catch((error) => {
          updateNodeFailure(state, node.url)
          const message = error instanceof Error ? error.message : String(error)
          if (!firstFailure) {
            firstFailure = buildErrorResponse(payload.id, -32000, `${node.url} failed: ${message}`)
          }
          finished += 1
          if (finished >= candidates.length) {
            settle(firstFailure ?? buildErrorResponse(payload.id, -32000, `All RPC nodes failed for ${network}`))
          }
        })
    })
  })
}

async function dispatchPayload(network: FastRpcNetwork, payload: JsonRpcPayload): Promise<JsonRpcResponse> {
  const cacheable = isCacheableMethod(payload.method)
  const cacheKey = cacheable ? makeCacheKey(network, payload.method, payload.params) : null

  if (cacheable && cacheKey) {
    const cached = READ_CACHE.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      try {
        const result = await cached.promise
        return buildSuccessResponse(payload.id, result)
      } catch {
        READ_CACHE.delete(cacheKey)
      }
    } else if (cached) {
      READ_CACHE.delete(cacheKey)
    }
  }

  if (!cacheable || !cacheKey) {
    return await racePayload(network, payload)
  }

  const promise = racePayload(network, payload)
    .then((response) => {
      if ('error' in response) {
        throw new RpcResponseError(response)
      }
      return response.result
    })
    .catch((error) => {
      READ_CACHE.delete(cacheKey)
      throw error
    })

  READ_CACHE.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    promise,
  })

  try {
    const result = await promise
    return buildSuccessResponse(payload.id, result)
  } catch (error) {
    if (error instanceof RpcResponseError) {
      return {
        ...error.response,
        id: payload.id,
      }
    }
    return buildErrorResponse(
      payload.id,
      -32000,
      error instanceof Error ? error.message : String(error),
    )
  }
}

export class FastRpcProvider extends JsonRpcProvider {
  readonly networkKey: FastRpcNetwork

  constructor(network: FastRpcNetwork) {
    super(
      NETWORK_CONFIG[network].rpcUrls[0],
      NETWORK_CONFIG[network].chainId,
    )
    this.networkKey = network
    this._start()
    void benchmarkNetwork(network)
  }

  override async _send(payload: any): Promise<any> {
    const payloads = (Array.isArray(payload) ? payload : [payload]) as JsonRpcPayload[]
    return await Promise.all(payloads.map((item) => dispatchPayload(this.networkKey, item)))
  }
}

export function createRpcProvider(network: Network) {
  if (isFastRpcNetwork(network)) {
    return new FastRpcProvider(network)
  }
  return new JsonRpcProvider(NETWORK_CONFIG[network].rpcUrls[0], NETWORK_CONFIG[network].chainId)
}

export function warmupRpcProviders() {
  FAST_RPC_NETWORKS.forEach((network) => {
    void benchmarkNetwork(network)
  })
}

if (typeof fetch === 'function') {
  warmupRpcProviders()
}
