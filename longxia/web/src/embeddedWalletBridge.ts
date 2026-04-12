type ProviderRequestArgs = {
  method: string
  params?: unknown[]
}

type ProviderLike = {
  request: (args: ProviderRequestArgs) => Promise<unknown>
  on: (event: string, handler: (...args: any[]) => void) => void
  removeListener: (event: string, handler: (...args: any[]) => void) => void
  selectedAddress?: string | null
  chainId?: string
  providers?: ProviderLike[]
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: number
}

class ParentWalletBridgeProvider implements ProviderLike {
  selectedAddress: string | null = null
  chainId = "0x38"
  private origin: string | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(...args: any[]) => void>>()

  constructor() {
    if (typeof window === "undefined") return
    try {
      this.origin = document.referrer ? new URL(document.referrer).origin : null
    } catch {
      this.origin = null
    }
    window.addEventListener("message", this.handleMessage)
  }

  request({ method, params }: ProviderRequestArgs): Promise<unknown> {
    if (!this.origin || typeof window === "undefined" || window.parent === window) {
      return Promise.reject(new Error("Parent wallet bridge unavailable"))
    }

    const id = `longxia-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Parent wallet bridge timeout: ${method}`))
      }, 15000)

      this.pending.set(id, { resolve, reject, timer })
      const origin = this.origin
      if (!origin) {
        this.pending.delete(id)
        window.clearTimeout(timer)
        reject(new Error("Parent wallet bridge unavailable"))
        return
      }
      window.parent.postMessage(
        {
          type: "LONGXIA_PROVIDER_REQUEST",
          id,
          method,
          params: params ?? []
        },
        origin
      )
    })
  }

  on(event: string, handler: (...args: any[]) => void) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(handler)
    this.listeners.set(event, set)
  }

  removeListener(event: string, handler: (...args: any[]) => void) {
    const set = this.listeners.get(event)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this.listeners.delete(event)
  }

  private emit(event: string, payload: unknown) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of set) handler(payload)
  }

  private handleMessage = (event: MessageEvent) => {
    if (!this.origin || event.origin !== this.origin) return
    const data = event.data as
      | { type?: string; id?: string; result?: unknown; error?: { message?: string }; event?: string; data?: unknown }
      | undefined
    if (!data?.type) return

    if (data.type === "LONGXIA_PROVIDER_RESPONSE" && data.id) {
      const pending = this.pending.get(data.id)
      if (!pending) return
      window.clearTimeout(pending.timer)
      this.pending.delete(data.id)
      if (data.error?.message) {
        pending.reject(new Error(data.error.message))
        return
      }
      pending.resolve(data.result)
      return
    }

    if (data.type === "LONGXIA_PROVIDER_EVENT" && data.event) {
      if (data.event === "accountsChanged") {
        const list = Array.isArray(data.data) ? (data.data as unknown[]) : []
        this.selectedAddress = typeof list[0] === "string" ? (list[0] as string) : null
      }
      if (data.event === "chainChanged" && typeof data.data === "string") {
        this.chainId = data.data
      }
      this.emit(data.event, data.data)
    }
  }
}

let parentBridgeProvider: ParentWalletBridgeProvider | null = null

function getParentBridgeProvider() {
  if (typeof window === "undefined") return null
  if (window.parent === window) return null
  if (!parentBridgeProvider) parentBridgeProvider = new ParentWalletBridgeProvider()
  return parentBridgeProvider
}

export function getPreferredInjectedProvider(inputWindow?: unknown): ProviderLike | undefined {
  const w = (inputWindow ?? window) as Record<string, any>
  const eth = w?.ethereum as ProviderLike | undefined
  const multi = Array.isArray(eth?.providers) ? eth.providers : []
  const candidates = [
    ...multi,
    eth,
    w?.okxwallet,
    w?.tokenpocket,
    w?.tpwallet,
    w?.bitkeep?.ethereum,
    w?.web3?.currentProvider,
    getParentBridgeProvider()
  ].filter(Boolean) as ProviderLike[]

  return candidates.find((provider) => typeof provider?.request === "function")
}
