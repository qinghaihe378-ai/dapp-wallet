# 龙虾（BNB Chain Meme 一键发币）

## 目录结构

- contracts：Solidity 0.8.20 合约（Hardhat + OpenZeppelin）
- web：前端（Vite + React + Tailwind + Wagmi + MetaMask）

## 合约功能清单

- 工厂合约一键发币（名称、符号、描述、Logo）
- Bonding Curve（恒定乘积曲线）自动定价，支持买卖
- 募资达到阈值（创建时可选 6 BNB / 16.5 BNB）自动迁移：向 PancakeSwap V2 创建 Pair 并注入全额流动性
- 流动性自动锁仓（Pancake V2 LP Token 锁仓 2000 天，到期由平台方领取）
- 防狙击：迁移后开启交易延迟（默认 120 秒）
- 平台收费：
  - 发币固定收 0.005 BNB
  - 交易抽成 2%（买 1% + 卖 1%）
- 可选机制：税费版（无营销功能），支持持币分红 / 代币销毁 / 加池 / 回流；税率 0.1%-5% 与分配比例可配置
- 安全：ReentrancyGuard、Solidity 0.8 溢出检查、权限控制（Owner/Factory/Market）

## 安装

```bash
npm install
```

## 合约：配置与部署

复制并填写根目录环境变量：

```bash
cp .env.example .env
```

必须配置：

- DEPLOYER_PRIVATE_KEY：部署账户私钥
- TREASURY_ADDRESS：平台收款地址（发币费 + 交易手续费）
- BNB_RPC_URL / BNB_TESTNET_RPC_URL：RPC
- WBNB_BSC / WBNB_BSC_TESTNET：WBNB 地址
- PANCAKE_V2_ROUTER_BSC / PANCAKE_V2_ROUTER_BSC_TESTNET：PancakeSwap V2 Router 地址
- BSCSCAN_API_KEY：BscScan API Key（用于验证源码/开源显示）

部署到 BSC Testnet：

```bash
npm -w contracts run deploy:testnet
```

部署到 BSC Mainnet：

```bash
npm -w contracts run deploy:mainnet
```

部署输出会打印：

- factory：MemeTokenFactory 地址（前端要用）
- locker：LiquidityLocker 地址
- taxDeployer：TaxTokenDeployer 地址
- deployments：写入的 deployments 文件路径（后续 verify/监听会用）

## 合约：BscScan 验证（开源显示源码）

部署完成后执行：

```bash
npm -w contracts run verify:mainnet
```

给某个 Token/Market 验证源码（把 TOKEN_ADDRESS 换成代币地址）：

```bash
TOKEN_ADDRESS=0xYourTokenAddress npm -w contracts run verify:token:mainnet
```

自动验证（监听 TokenCreated 事件，适合放到服务器/PM2 常驻）：

```bash
npm -w contracts run watch:verify:mainnet
```

## 合约：测试

```bash
npm -w contracts test
```

测试覆盖：

- 发币与发币费到账
- Bonding Curve 买卖与手续费
- 达标自动迁移到 V2 + 锁仓

## 前端：配置与运行

复制并填写前端环境变量：

```bash
cp web/.env.example web/.env
```

填写：

- VITE_FACTORY_ADDRESS_BSC：主网工厂地址
- VITE_FACTORY_ADDRESS_BSC_TESTNET：测试网工厂地址

本地运行：

```bash
npm -w web dev
```

生产构建：

```bash
npm -w web build
```

## 上线要点

- 生产 RPC 建议使用高可用、带限流保护的节点
- TREASURY_ADDRESS 建议用多签
- 部署前确认 PancakeSwap V3 PositionManager / WBNB 地址来自官方来源
