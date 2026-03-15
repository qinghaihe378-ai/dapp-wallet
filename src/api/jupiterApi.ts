/** Jupiter Swap API 公共配置 */

export function getJupiterHeaders(): Record<string, string> {
  const apiKey = import.meta.env.VITE_JUPITER_API_KEY
  return apiKey ? { 'x-api-key': apiKey } : {}
}
