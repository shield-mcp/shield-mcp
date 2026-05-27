# shield//mcp — tutorial

Give your AI agent private, shielded transactions on Base. Two ways: the
**hosted** endpoint (no install), or **self-host** locally.

---

## Option A — Hosted (remote MCP, no install) · recommended

Point your MCP-capable agent at the hosted shield//mcp endpoint and pass your
wallet key as a header. Nothing to clone, build, or run.

**Endpoint:** `https://mcp.shieldmcp.sh/mcp`

Add it to your agent's MCP config (example):

```json
{
  "mcpServers": {
    "shield": {
      "url": "https://mcp.shieldmcp.sh/mcp",
      "headers": { "x-shield-key": "0xYOUR_AGENT_WALLET_PRIVATE_KEY" }
    }
  }
}
```

> **Non-custodial.** Your key is used only in your session's server memory to
> derive your shielded keypair and sign — it is **never stored, logged, or
> written to disk**, and is dropped when your session ends. The server holds no
> wallet and no funds. Use a **dedicated agent wallet**, not your main one.

That's it — your agent now has the shield tools. Jump to [§3](#3-your-first-shielded-flow).

---

## Option B — Self-host (local, stdio)

Run the server yourself; your key never leaves your machine.

```bash
git clone https://github.com/shield-mcp/shield-mcp.git && cd shield-mcp
npm install
cp .env.example .env       # set SHIELD_PRIVATE_KEY + SHIELD_RPC_URLS
npm run build
```

Register it with your agent host (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "shield": {
      "command": "node",
      "args": ["/absolute/path/to/shield-mcp/dist/index.js"],
      "env": {
        "SHIELD_RPC_URLS": "https://mainnet.base.org",
        "SHIELD_PRIVATE_KEY": "0xYOUR_AGENT_WALLET_PRIVATE_KEY"
      }
    }
  }
}
```

---

## 1. Prerequisites

- An MCP-capable agent/client
- A **dedicated** EVM wallet private key for the agent (a fresh wallet)
- A little ETH on Base for gas, and the token you want to shield (e.g. USDC)

## 2. Notes

- **Amounts are strings in base units (wei).** USDC/USDT = 6 decimals (5 USDC = `5000000`), ETH = 18.
- **Tokens** can be passed by symbol (`USDC`) or `0x` address on Base.
- **Under $10k = zero verification.** Agents onboard with no friction.
- First call of a session warms up the shielded state (a few seconds–minutes).

## 3. Your first shielded flow

**Status & address**
> `shield_status` → `{ chain: "Base", address, accessToken }`
> `get_shielded_address` → your shielded receive address.

**Shield (public → private)**
> *"shield 5 USDC"* → `shield(token: "USDC", amount: "5000000")`

**Private balance**
> *"what's my shielded balance?"* → `get_private_balance`

**Pay privately (private → private)**
> *"send 2 USDC privately to `<shielded address>`"* → `private_transfer(token, "2000000", recipient)`

**Withdraw (private → public)**
> *"unshield 1 USDC to `0xRecipient`"* → `unshield(token, "1000000", "0xRecipient")`

## 4. Tool reference

| tool | args |
|------|------|
| `shield_status` | — |
| `get_shielded_address` | — |
| `get_private_balance` | — |
| `shield` | `token`, `amount` |
| `private_transfer` | `token`, `amount`, `recipient`, `feeToken?` |
| `unshield` | `token`, `amount`, `recipient`, `useRelayer?`, `feeToken?` |
| `private_swap` | `tokenIn`, `amount`, `tokenOut`, `feeToken?` |

Questions? Ask the ghost at [shieldmcp.sh](https://shieldmcp.sh).
