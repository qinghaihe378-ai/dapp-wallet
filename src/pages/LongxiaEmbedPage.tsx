import { useEffect, useMemo, useRef } from 'react'
import { ethers } from 'ethers'
import { useWallet } from '../components/WalletProvider'
import { getLongxiaIframeSrc } from '../lib/longxiaIframeSrc'

export function LongxiaEmbedPage() {
  const src = useMemo(() => getLongxiaIframeSrc(), [])
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const { address, chainId, signer, switchNetwork } = useWallet()

  useEffect(() => {
    let allowedOrigin: string | null = null
    try {
      allowedOrigin = new URL(src).origin
    } catch {
      allowedOrigin = null
    }

    const handler = (event: MessageEvent) => {
      const data = event.data as any
      if (!allowedOrigin) return
      if (event.origin !== allowedOrigin) return

      if (data?.type === 'LONGXIA_PROVIDER_REQUEST' && data.id && typeof data.method === 'string') {
        const send = (payload: Record<string, unknown>) => {
          const source = event.source as Window | null
          source?.postMessage({ type: 'LONGXIA_PROVIDER_RESPONSE', id: data.id, ...payload }, event.origin)
        }

        void (async () => {
          try {
            const params = Array.isArray(data.params) ? data.params : []
            switch (data.method) {
              case 'eth_accounts':
              case 'eth_requestAccounts':
                if (!address) throw new Error('请先在主站钱包页创建、导入或连接钱包')
                send({ result: [address] })
                return
              case 'eth_chainId':
                send({ result: `0x${(chainId ?? 56).toString(16)}` })
                return
              case 'net_version':
                send({ result: String(chainId ?? 56) })
                return
              case 'wallet_switchEthereumChain': {
                const next = params[0] as { chainId?: string } | undefined
                const target = typeof next?.chainId === 'string' ? next.chainId.toLowerCase() : ''
                if (target !== '0x38') throw new Error('龙虾仅支持 BSC 主网')
                await switchNetwork('bsc')
                send({ result: null })
                return
              }
              case 'eth_sendTransaction': {
                if (!signer || !address) throw new Error('未连接主站钱包')
                const tx = (params[0] as Record<string, unknown> | undefined) ?? {}
                const from = typeof tx.from === 'string' ? tx.from.toLowerCase() : null
                if (from && from !== address.toLowerCase()) throw new Error('发送地址与当前钱包不一致')
                const response = await signer.sendTransaction({
                  to: typeof tx.to === 'string' ? tx.to : undefined,
                  data: typeof tx.data === 'string' ? tx.data : undefined,
                  value: typeof tx.value === 'string' || typeof tx.value === 'number' || typeof tx.value === 'bigint' ? tx.value : undefined,
                  gasLimit: typeof tx.gas === 'string' || typeof tx.gas === 'number' || typeof tx.gas === 'bigint' ? tx.gas : undefined,
                  gasPrice:
                    typeof tx.gasPrice === 'string' || typeof tx.gasPrice === 'number' || typeof tx.gasPrice === 'bigint'
                      ? tx.gasPrice
                      : undefined,
                  nonce: typeof tx.nonce === 'number' ? tx.nonce : undefined
                })
                send({ result: response.hash })
                return
              }
              case 'eth_getBalance': {
                if (!signer) throw new Error('未连接主站钱包')
                const provider = signer.provider
                const target = typeof params[0] === 'string' ? params[0] : address
                if (!provider || !target) throw new Error('无法读取余额')
                const balance = await provider.getBalance(target)
                send({ result: ethers.toQuantity(balance) })
                return
              }
              case 'personal_sign': {
                if (!signer) throw new Error('未连接主站钱包')
                const raw = params[0]
                const message =
                  typeof raw === 'string' && raw.startsWith('0x') ? ethers.getBytes(raw) : typeof raw === 'string' ? raw : ''
                const signature = await signer.signMessage(message)
                send({ result: signature })
                return
              }
              default:
                throw new Error(`暂不支持的方法: ${data.method}`)
            }
          } catch (error) {
            send({ error: { message: error instanceof Error ? error.message : String(error) } })
          }
        })()
        return
      }

      if (!data || data.type !== 'LONGXIA_OPEN_TOP') return
      const nextUrl = typeof data.url === 'string' ? data.url : ''
      if (!nextUrl) return
      try {
        const u = new URL(nextUrl)
        if (u.origin !== allowedOrigin) return
        window.location.href = u.href
      } catch {
        return
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [address, chainId, signer, src, switchNetwork])

  useEffect(() => {
    let allowedOrigin: string | null = null
    try {
      allowedOrigin = new URL(src).origin
    } catch {
      allowedOrigin = null
    }
    if (!allowedOrigin) return
    const post = (event: string, data: unknown) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'LONGXIA_PROVIDER_EVENT', event, data }, allowedOrigin)
    }
    post('accountsChanged', address ? [address] : [])
    post('chainChanged', `0x${(chainId ?? 56).toString(16)}`)
  }, [address, chainId, src])

  return (
    <div className="longxia-embed-page">
      {import.meta.env.DEV &&
      !import.meta.env.VITE_LOBSTER_LAUNCH_URL?.trim() &&
      !import.meta.env.VITE_LONGXIA_DEV_ORIGIN?.trim() ? (
        <p className="longxia-embed-hint">
          开发模式：请另开终端执行 <code>cd longxia/web && npm run dev</code>，或配置{' '}
          <code>VITE_LONGXIA_DEV_ORIGIN</code>。
        </p>
      ) : null}
      <iframe
        ref={iframeRef}
        title="龙虾 BSC 发币"
        className="longxia-embed-frame"
        src={src}
        allow="clipboard-read; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
