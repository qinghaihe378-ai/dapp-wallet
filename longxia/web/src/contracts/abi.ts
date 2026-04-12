export const memeTokenFactoryAbi = [
  {
    type: "function",
    name: "creationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "locker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "allTokensLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "allTokens",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "tokenInfo",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      { type: "address", name: "token" },
      { type: "address", name: "market" },
      { type: "address", name: "creator" },
      { type: "uint40", name: "createdAt" },
      { type: "string", name: "description" },
      { type: "string", name: "logo" },
      { type: "string", name: "telegram" },
      { type: "string", name: "twitter" },
      { type: "string", name: "website" },
      { type: "uint8", name: "templateId" },
      { type: "uint16", name: "taxBps" },
      { type: "uint16", name: "burnShareBps" },
      { type: "uint16", name: "holderShareBps" },
      { type: "uint16", name: "liquidityShareBps" },
      { type: "uint16", name: "buybackShareBps" }
    ]
  },
  {
    type: "function",
    name: "createToken",
    stateMutability: "payable",
    inputs: [
      { type: "string", name: "name" },
      { type: "string", name: "symbol" },
      { type: "string", name: "description" },
      { type: "string", name: "logo" },
      { type: "string", name: "telegram" },
      { type: "string", name: "twitter" },
      { type: "string", name: "website" },
      { type: "uint256", name: "targetRaiseOverride" },
      { type: "uint8", name: "templateId" },
      { type: "uint16", name: "taxBps" },
      { type: "uint16", name: "burnShareBps" },
      { type: "uint16", name: "holderShareBps" },
      { type: "uint16", name: "liquidityShareBps" },
      { type: "uint16", name: "buybackShareBps" }
    ],
    outputs: [
      { type: "address", name: "token" },
      { type: "address", name: "market" }
    ]
  },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { indexed: true, type: "address", name: "token" },
      { indexed: true, type: "address", name: "market" },
      { indexed: true, type: "address", name: "creator" }
    ],
    anonymous: false
  }
] as const

export const bondingCurveMarketAbi = [
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }]
  },
  {
    type: "function",
    name: "targetRaise",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "tokenReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "migrated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "bnbIn" }],
    outputs: [
      { type: "uint256", name: "tokensOut" },
      { type: "uint256", name: "feePaid" }
    ]
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokensIn" }],
    outputs: [
      { type: "uint256", name: "bnbOut" },
      { type: "uint256", name: "feePaid" }
    ]
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { type: "address", name: "recipient" },
      { type: "uint256", name: "minTokensOut" }
    ],
    outputs: [{ type: "uint256", name: "tokensOut" }]
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "tokensIn" },
      { type: "uint256", name: "minBnbOut" },
      { type: "address", name: "recipient" }
    ],
    outputs: [{ type: "uint256", name: "bnbOut" }]
  },
  {
    type: "function",
    name: "migrateIfReady",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { indexed: true, type: "address", name: "buyer" },
      { indexed: false, type: "uint256", name: "bnbIn" },
      { indexed: false, type: "uint256", name: "tokensOut" },
      { indexed: false, type: "uint256", name: "feePaid" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { indexed: true, type: "address", name: "seller" },
      { indexed: false, type: "uint256", name: "tokensIn" },
      { indexed: false, type: "uint256", name: "bnbOut" },
      { indexed: false, type: "uint256", name: "feePaid" }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Migrated",
    inputs: [
      { indexed: true, type: "address", name: "pair" },
      { indexed: true, type: "bytes32", name: "lockId" },
      { indexed: false, type: "uint256", name: "tokenAmount" },
      { indexed: false, type: "uint256", name: "bnbAmount" },
      { indexed: false, type: "uint256", name: "liquidity" }
    ],
    anonymous: false
  }
] as const

export const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }]
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }]
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const

export const memeTokenTaxAbi = [
  {
    type: "function",
    name: "withdrawableDividendOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "claimDividend",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
  }
] as const
