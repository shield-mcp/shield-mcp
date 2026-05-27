# shield//mcp — tutorial

A step-by-step guide to giving your AI agent private, shielded transactions on Base.

## 1. Prerequisites

- Node.js 20+
- An MCP-capable agent/client (e.g. Claude Desktop, or any MCP host)
- A dedicated EVM private key for the agent (a fresh wallet)
- A Base RPC URL (the public `https://mainnet.base.org` works)
- A little ETH on Base for gas, and the token you want to shield (e.g. USDC)

## 2. Install

```bash
git clone https://github.com/shield-mcp/shield-mcp.git
cd shield-mcp
npm install
npm run build
```

## 3. Configure

Copy the example env and set your values:

```bash
cp .env.example .env
```

```ini
# .env
SHIELD_RPC_URLS=https://mainnet.base.org
SHIELD_PRIVATE_KEY=0x...   # dedicated agent wallet — keep it secret
```

> The private key never leaves your machine. shield//mcp derives the agent's
> shielded keypair locally from a signature by this key.

## 4. Run as an MCP server

```bash
node dist/index.js
```

It speaks MCP over stdio. Register it with your agent host. For Claude Desktop, add it
to your MCP config:

```json
{
  "mcpServers": {
    "shield": {
      "command": "node",
      "args": ["/absolute/path/to/shield-mcp/dist/index.js"],
      "env": {
        "SHIELD_RPC_URLS": "https://mainnet.base.org",
        "SHIELD_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## 5. Your first shielded flow

Once connected, your agent has the shield tools. Example conversation:

**Check status & address**
> *agent:* call `shield_status` → `{ chain: "Base", accessToken: ..., address: "0x…" }`
> *agent:* call `get_shielded_address` → your `0zk`-style private receive address.

**Shield funds (public → private)**
> *"shield 5 USDC."*
> agent calls `shield(token: "USDC", amount: "5000000")` → deposits into the pool.
> *(amounts are in base units / wei — USDC has 6 decimals, so 5 USDC = `5000000`.)*

**Check private balance**
> *"what's my shielded balance?"*
> agent calls `get_private_balance` → lists shielded holdings.

**Pay privately (private → private)**
> *"send 2 USDC privately to `<shielded address>`."*
> agent calls `private_transfer(token: "USDC", amount: "2000000", recipient: "<shielded addr>")`.
> Sender, recipient and amount stay hidden; relayed natively.

**Withdraw (private → public)**
> *"unshield 1 USDC to `0xRecipient`."*
> agent calls `unshield(token: "USDC", amount: "1000000", recipient: "0xRecipient")`.

## 6. Notes & tips

- **Amounts are strings in base units (wei).** USDC/USDT = 6 decimals, ETH = 18.
- **Under $10k = zero verification.** Agents onboard with no friction.
- **Tokens** can be passed by symbol (`USDC`) or `0x` address on Base.
- **Fees** for relayed transfers are paid from inside the pool in the fee token.
- Keep one private op settling before firing the next, so balances refresh.

## 7. Tool reference

| tool | args |
|------|------|
| `shield_status` | — |
| `get_shielded_address` | — |
| `get_private_balance` | — |
| `shield` | `token`, `amount` |
| `private_transfer` | `token`, `amount`, `recipient`, `feeToken?` |
| `unshield` | `token`, `amount`, `recipient`, `useRelayer?`, `feeToken?` |

Questions? Ask the ghost at [shield-mcp.netlify.app](https://shield-mcp.netlify.app).
