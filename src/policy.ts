/**
 * Client-side policy guard — bounds what an autonomous agent can do through the
 * MCP tools, so a prompt-injected/compromised agent CANNOT drain the wallet.
 *
 * Enforced in-process, before every fund-moving op. Strong when the agent acts
 * ONLY through these tools (the design: the MCP holds the key, the agent calls
 * tools). Client-side guard, not on-chain — Hinkal has no native session-key /
 * spend-permission primitive, so this is the right level here.
 *
 * Config (all optional; unset = unrestricted, with a startup warning):
 *   SHIELD_RECIPIENT_ALLOWLIST  comma-separated addresses — transfer/unshield may
 *                               only send to these. The #1 anti-drain control.
 *   SHIELD_MAX_PER_TX           max amount per op, in base units (wei).
 *   SHIELD_MAX_OPS_PER_DAY      max fund-moving ops per rolling 24h.
 */

function readConfig() {
  return {
    allowlist: new Set(
      (process.env.SHIELD_RECIPIENT_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    maxPerTx: process.env.SHIELD_MAX_PER_TX ? BigInt(process.env.SHIELD_MAX_PER_TX) : null,
    maxOpsPerDay: process.env.SHIELD_MAX_OPS_PER_DAY ? Number(process.env.SHIELD_MAX_OPS_PER_DAY) : null,
  };
}

export function policyConfigured(): boolean {
  const c = readConfig();
  return c.allowlist.size > 0 || c.maxPerTx != null || c.maxOpsPerDay != null;
}

export type PolicyCheck = { amount?: bigint; recipient?: string };

let windowStart = Date.now();
let opsInWindow = 0;

/** Throw if the requested op violates the configured policy. Call before each write. */
export function enforcePolicy(op: string, check: PolicyCheck): void {
  const { allowlist, maxPerTx, maxOpsPerDay } = readConfig();

  if (maxOpsPerDay != null) {
    const now = Date.now();
    if (now - windowStart > 86_400_000) {
      windowStart = now;
      opsInWindow = 0;
    }
    if (opsInWindow >= maxOpsPerDay) {
      throw new Error(`policy: daily op limit (${maxOpsPerDay}) reached`);
    }
  }

  if (maxPerTx != null && check.amount != null && check.amount > maxPerTx) {
    throw new Error(`policy: ${op} amount ${check.amount} exceeds SHIELD_MAX_PER_TX (${maxPerTx})`);
  }

  if (allowlist.size > 0 && check.recipient && !allowlist.has(check.recipient.toLowerCase())) {
    throw new Error(`policy: ${op} recipient is not in SHIELD_RECIPIENT_ALLOWLIST`);
  }

  // Count only after all checks pass — a rejected op shouldn't burn the daily budget.
  if (maxOpsPerDay != null) opsInWindow++;
}
