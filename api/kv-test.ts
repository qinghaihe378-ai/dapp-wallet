// 简单的 KV 连通性测试接口（Vercel Node Function）
// 部署到 Vercel 后访问 /api/kv-test

export default async function handler(req: any, res: any) {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    res.status(500).json({
      ok: false,
      message: 'KV_REST_API_URL 或 KV_REST_API_TOKEN 未配置，检查 Vercel 环境变量是否填写正确。',
    })
    return
  }

  const key = 'clawdex:kv-test'
  const value = `pong-${Date.now()}`

  try {
    const setRes = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!setRes.ok) {
      const text = await setRes.text().catch(() => '')
      throw new Error(`SET 失败: ${setRes.status} ${text}`)
    }

    const getRes = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!getRes.ok) {
      const text = await getRes.text().catch(() => '')
      throw new Error(`GET 失败: ${getRes.status} ${text}`)
    }

    // Upstash 返回可能是 JSON，也可能是纯文本；这里兼容两种
    const raw = await getRes.text()
    let readBack: unknown = raw
    try {
      readBack = JSON.parse(raw)
    } catch {}

    res.status(200).json({
      ok: true,
      message: 'KV 连接成功，可以正常读写。',
      wrote: value,
      readBack,
      key,
    })
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

