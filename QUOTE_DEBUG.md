# Base 报价流程检查说明

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/lib/bot/parseBuyMessage.ts` | 解析指令，提取 chain/amount/payToken/buyToken，去除地址末尾多余字符 |
| `src/pages/BotPage.tsx` | 处理输入，调用 `getBestLiveQuote`，展示错误 |
| `src/lib/evm/quote.ts` | 报价核心：并行请求各协议，无报价时抛出提示 |
| `src/api/uniswapTrade.ts` | Uniswap API（V4），API Key 优先读 localStorage |
| `src/lib/evm/config.ts` | Base 协议：Uniswap V4/V3/V2、Aerodrome |
| `src/lib/evm/balances.ts` | `fetchEvmTokenByAddress`：获取合约 symbol/decimals |
| `src/lib/walletConfig.ts` | Base RPC 配置（已增加备用 RPC） |

## 报价流程（Base）

1. **parseBuyMessage** → chain=base, amount, payToken=ETH, buyToken=0x...
2. **fetchEvmTokenByAddress** → 用 Base RPC 获取 symbol、decimals（多 RPC 重试）
3. **switchNetwork**（若当前非 Base）→ 切换后 useEffect 触发 runEvmBuy
4. **getBestLiveQuote** 并行请求：Uniswap API、V3、V2、Aerodrome
5. 路径：ETH→代币、ETH→WETH→代币、ETH→USDC→代币、ETH→USDbC→代币
6. 全部 null → 抛出错误提示

## 已做修复

- **Base 多 RPC**：`walletConfig.ts` 增加 base.llamarpc.com、ankr、blastapi 等备用 RPC，提高 `fetchEvmTokenByAddress` 成功率

## 可能原因

1. **代币无流动性**：在 Uniswap V2/V3、Aerodrome 上均无 WETH/USDC/USDbC 池子
2. **Uniswap API**：未配置 Key、网络不可达、或代币不在 API 路由图
3. **RPC 限流**：官方 mainnet.base.org 有速率限制，已加备用 RPC
