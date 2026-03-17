// 简单的 KV 连通性测试接口
// 部署到 Vercel 后，访问 /api/kv-test 就能看到结果

export default async function handler(req: Request): Promise<Response> {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: 'KV_REST_API_URL 或 KV_REST_API_TOKEN 未配置，检查 Vercel 环境变量绑定是否正确。',
      }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }

  const key = 'clawdex:kv-test'
  const value = `pong-${Date.now()}`

  try {
    // 写入一个测试键
    const setRes = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!setRes.ok) {
      const text = await setRes.text().catch(() => '')
      throw new Error(`SET 失败: ${setRes.status} ${text}`)
    }

    // 读回这个键
    const getRes = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!getRes.ok) {
      const text = await getRes.text().catch(() => '')
      throw new Error(`GET 失败: ${getRes.status} ${text}`)
    }
    const got = await getRes.text()

    return new Response(
      JSON.stringify({
        ok: true,
        message: 'KV 连接成功，可以正常读写。',
        urlConfigured: Boolean(url),
        wrote: value,
        readBack: got,
        key,
      }),
      { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }
}

