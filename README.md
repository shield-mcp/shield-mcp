# shield//mcp

> the vanishing act for onchain agents — maximum-privacy transactions on Base.

**shield//mcp** is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server that gives autonomous AI agents **maximum on-chain privacy** on Base. It wraps
the agent's wallet so its transactions are *shielded*: **sender, recipient and amount
are hidden** inside a zkSNARK (Groth16) anonymity pool.

Your agents transact. Nobody watches.

**Live demo:** [shieldmcp.sh](https://shieldmcp.sh) · **Endpoint:** `https://mcp.shieldmcp.sh/mcp`

---

## Why

Agents that hold and move funds expose their entire financial life on a public ledger —
every balance, every counterparty, every payment, forever linkable. shield//mcp lets an
agent pay, hold and move value with **no public, linkable trail** — while staying
**compliance-friendly** (it is *not* a blind mixer).

Same privacy class as Railgun/Monero — but on **Base**, and built for agents.

## What's hidden

Full shielding via zkSNARK + Merkle anonymity set:

- ✓ amount
- ✓ sender
- ✓ recipient
- ✓ transaction history (unlinkable)
- ✓ self-custodial — you hold your keys

Private transfers are **relayed natively**: no public wallet of yours touches the chain,
and the relayer fee is paid from inside the pool.

## MCP tools

| tool | what it does |
|------|--------------|
| `shield_status` | account, chain, and compliance state |
| `get_shielded_address` | your shielded receive address (share it to be paid privately) |
| `get_private_balance` | shielded balances held in the pool |
| `shield` | deposit a public ERC-20 into the shielded pool |
| `private_transfer` | send privately to a shielded address (relayed, unlinkable) |
| `unshield` | withdraw from the pool to a public address |
| `private_swap` | private swap (tokenIn → tokenOut), aggregator-routed, output re-shielded |

## Privacy + compliance

shield//mcp is **compliant privacy**, not a mixer:

- Deposits up to **$10k require no verification at all** — agents just run.
- Above $10k: a **zkTLS** attestation (prove you control a CEX account) or zkMe.
  This is **not identity KYC** — no personal data is stored, only a zero-knowledge
  proof of non-sanctioned status.

The per-address access gate keeps illicit funds out of the pool — the line between
compliant privacy and a criminal mixer.

## Chain & stack

- **Chain:** Base mainnet (`8453`)
- **Privacy engine:** zkSNARK shielded pool (Groth16 + Merkle anonymity set)
- **Protocol:** Model Context Protocol (stdio server)
- **Language:** TypeScript

## Get started

**Hosted (no install).** Point your MCP-capable agent at the hosted endpoint and
pass a dedicated agent wallet key as a header:

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

Non-custodial: your key lives only in your session's memory (never stored, logged,
or written to disk) and is dropped when the session ends. The server holds no
wallet and no funds. Use a dedicated agent wallet.

Prefer to self-host locally? See **[TUTORIAL.md](./TUTORIAL.md)** for both paths.

## Status

`shield`, `private_transfer`, `unshield` and `private_swap` are all validated
live on Base mainnet.

## License

[MIT](./LICENSE)
