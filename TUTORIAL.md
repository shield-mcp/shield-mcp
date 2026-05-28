# shield//mcp — tutorial

Give your AI agent private, shielded transactions on Base — **non-custodially**.

> ⚠️ **Golden rule: never send a private key to a remote server.** A hosted MCP that
> receives your raw key is *custodial* — whoever runs it can move your funds. That is
> NOT shield//mcp. shield//mcp runs the privacy engine **client-side**: your key and
> the zk proofs stay on your machine; a broadcast-only relayer never sees your key.

**Status:** the non-custodial **local** client is available now (below) — your key
never leaves your machine. A hosted broadcast-only relayer (still non-custodial,
never sees your key) is on the roadmap.

---

## Run it locally (self-host) — your key never leaves your machine

There's also a ready-made **[skill](./skills/shield-mcp/SKILL.md)** that walks an
agent through this setup.

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
