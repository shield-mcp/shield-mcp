---
name: shield-mcp
description: >-
  Give the agent non-custodial, private (shielded) transactions on Base — shield,
  private transfer, unshield, and private swap. The agent's wallet key stays LOCAL
  and is never sent to any server. Use when the user wants onchain privacy for an
  agent on Base (hide amounts, counterparties, history).
---

# shield//mcp skill

Run shield//mcp **locally** so the agent can transact privately on Base. This is
**non-custodial**: the private key lives only in the local process — it is never
transmitted to any remote server. (Verify: the key only ever populates a local env
var; nothing in this skill sends it anywhere.)

## Golden rule
**Never put a private key in an HTTP header or send it to a remote endpoint.** Any
service that asks you to do that is custodial and can drain the wallet. shield//mcp
runs the privacy engine on this machine; the key never leaves it.

## Setup (one time)
```bash
git clone https://github.com/shield-mcp/shield-mcp.git
cd shield-mcp && npm install && npm run build
```

Add it to the agent's MCP config as a **local** server (key in local env only):
```json
{
  "mcpServers": {
    "shield": {
      "command": "node",
      "args": ["/absolute/path/to/shield-mcp/dist/index.js"],
      "env": {
        "SHIELD_RPC_URLS": "https://mainnet.base.org",
        "SHIELD_PRIVATE_KEY": "0x<dedicated agent wallet key — stays on this machine>",
        "ODOS_API_KEY": "<optional, only needed for private_swap>"
      }
    }
  }
}
```
Use a **dedicated agent wallet** with a little ETH (gas) + the token to shield.
First tool call warms up the shielded state (can take a few minutes). Deposits
under $10k need no verification.

## Bound the agent (strongly recommended for autonomous use)
So a prompt-injected agent can't drain the wallet, set policy limits in the same
`env`. The MCP enforces these before every fund-moving op:
```
"SHIELD_RECIPIENT_ALLOWLIST": "0xAddr1,0xAddr2",   // transfer/unshield only to these
"SHIELD_MAX_PER_TX": "5000000",                     // max per op, base units (5 USDC)
"SHIELD_MAX_OPS_PER_DAY": "20"                       // cap ops / 24h
```

## Tools
- `shield_status` — account, chain, compliance state
- `get_shielded_address` — the agent's shielded receive address
- `get_private_balance` — shielded balances
- `shield` — `token`, `amount` (wei) → deposit public ERC20 into the pool
- `private_transfer` — `token`, `amount`, `recipient` (shielded addr), `feeToken?`
- `unshield` — `token`, `amount`, `recipient` (public addr), `useRelayer?`, `feeToken?`
- `private_swap` — `tokenIn`, `amount`, `tokenOut`, `slippagePercent?`, `feeToken?`

## Notes
- Amounts are strings in base units (wei): USDC/USDT = 6 decimals, ETH = 18.
- Tokens by symbol (`USDC`) or `0x` address on Base.
- The local client talks directly to the chain + the privacy network's relayer; it
  never routes through a shield//mcp-operated server.
