import { ExternalActionId } from '@hinkal/common';
import { resolveToken, type HinkalSession } from './hinkal.js';
import { buildOdosSwap } from './odos.js';
import { enforcePolicy } from './policy.js';

/**
 * Hinkal write flow, scoped to a session. Proof generation, anonymity-pool
 * merkle work and the relayer are handled inside the SDK.
 *
 * SIGN CONVENTION: deposit uses a positive amount; transfer/withdraw/swap use a
 * NEGATIVE delta (funds leaving the shielded balance).
 */

async function finalize(res: unknown): Promise<string> {
  const tx = res as { hash?: string; wait?: () => Promise<unknown> };
  if (typeof tx?.wait === 'function') await tx.wait();
  return tx?.hash ?? (typeof res === 'string' ? res : 'submitted');
}

export const depositDelta = (amount: bigint) => amount;
export const privateSpendDelta = (amount: bigint) => -amount;

// ── settlement-aware retry — NO double-spend ─────────────────────────────────
// A spend can fail with "insufficient funds" when a note from a just-relayed op
// isn't yet confirmed/indexed in the anonymity set (async settlement). That error
// is raised during NOTE SELECTION — BEFORE any proof is generated or any tx is
// broadcast/relayed — so retrying after a re-sync CANNOT double-spend (no
// nullifier was published, nothing hit the chain). We therefore retry ONLY this
// pre-broadcast shortfall class; EVERY other error (a revert, a relayer error, a
// reused nullifier — anything that might already be on-chain) fails immediately
// and is never retried.
const SETTLING_RE = /insufficient funds|insufficient balance|no (?:spendable|unspent|available) note/i;

// Read lazily so they're configurable/testable without a rebuild.
function settleConfig() {
  return {
    retries: Number(process.env.SHIELD_SETTLE_RETRIES ?? 3),
    backoffMs: Number(process.env.SHIELD_SETTLE_BACKOFF_MS ?? 12_000),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a spend, retrying ONLY on a pre-broadcast "insufficient funds" shortfall.
 * `run` MUST re-sync (refreshState) and re-select notes itself on each call, so
 * each attempt sees freshly-confirmed notes. The caller holds the session
 * write-lock, so attempts never overlap. The spend is issued at most once per
 * attempt, and only after the previous attempt provably never broadcast — hence
 * no double-spend.
 */
async function withSettlementRetry<T>(op: string, run: () => Promise<T>): Promise<T> {
  const { retries, backoffMs } = settleConfig();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs);
    try {
      return await run();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!SETTLING_RE.test(msg)) throw e; // not a pre-broadcast shortfall -> never retry
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `${op}: funds still settling from a recent relayed op — the note isn't confirmed in the anonymity set yet ` +
      `(waited ~${Math.round((retries * backoffMs) / 1000)}s). Retry shortly, and leave headroom for the relay fee ` +
      `(a relayed transfer/unshield pays its fee from the same pool balance). [${detail}]`,
  );
}

/** Shield: deposit a public ERC20 into the Hinkal pool (public deposit). */
export async function shield(session: HinkalSession, tokenOrSymbol: string, amount: bigint): Promise<string> {
  return session.withWriteLock(async () => {
    enforcePolicy('shield', { amount });
    await session.refreshState();
    const token = resolveToken(tokenOrSymbol);
    const res = await (await session.ready()).deposit([token], [depositDelta(amount)]);
    return finalize(res);
  });
}

/** Private transfer to another shielded address (relayed, unlinkable). */
export async function privateTransfer(
  session: HinkalSession,
  tokenOrSymbol: string,
  amount: bigint,
  recipientShieldedAddress: string,
  feeTokenOrSymbol?: string,
): Promise<string> {
  return session.withWriteLock(async () => {
    enforcePolicy('private_transfer', { amount, recipient: recipientShieldedAddress }); // once, outside retry
    const token = resolveToken(tokenOrSymbol);
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    return withSettlementRetry('private_transfer', async () => {
      await session.refreshState();
      return (await session.ready()).transfer([token], [privateSpendDelta(amount)], recipientShieldedAddress, feeToken);
    });
  });
}

/** Unshield: withdraw from the pool to a public address. useRelayer keeps it unlinkable. */
export async function unshield(
  session: HinkalSession,
  tokenOrSymbol: string,
  amount: bigint,
  recipientAddress: string,
  useRelayer = true,
  feeTokenOrSymbol?: string,
): Promise<string> {
  return session.withWriteLock(async () => {
    enforcePolicy('unshield', { amount, recipient: recipientAddress }); // once, outside retry
    const token = resolveToken(tokenOrSymbol);
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    return withSettlementRetry('unshield', async () => {
      await session.refreshState();
      const res = await (await session.ready()).withdraw(
        [token],
        [privateSpendDelta(amount)],
        recipientAddress,
        !useRelayer,
        feeToken,
      );
      return finalize(res);
    });
  });
}

/**
 * Address to quote on the aggregator. Hinkal wraps native ETH -> WETH on-chain
 * (deposit before the swap, unwrap after), so the Odos route must target the
 * WRAPPED token, never the native zero address. Mirrors Hinkal's own getOdosPrice
 * (`wrappedErc20TokenAddress ?? erc20TokenAddress`). h.swap() still receives the
 * native token object so the SDK performs the wrap/unwrap.
 */
const routeAddress = (token: ReturnType<typeof resolveToken>): string =>
  token.wrappedErc20TokenAddress ?? token.erc20TokenAddress;

/**
 * Private swap inside the pool via Odos. Unshields tokenIn, runs the aggregator
 * swap, re-shields tokenOut — all private. The server builds the Odos route +
 * calldata; circuit shape is [tokenIn, tokenOut] with [-in, +out].
 * Validated live on Base (USDC→USDT, ETH↔USDC). Native ETH is supported (routed
 * via WETH). 1:1-ish/stable pairs are safest; volatile pairs rely on the slippage
 * limit. The Odos route is re-fetched on each settlement retry so calldata stays
 * fresh.
 */
export async function privateSwap(
  session: HinkalSession,
  tokenInOrSymbol: string,
  amount: bigint,
  tokenOutOrSymbol: string,
  feeTokenOrSymbol?: string,
  slippagePercent = 0.5,
): Promise<string> {
  return session.withWriteLock(async () => {
    enforcePolicy('private_swap', { amount }); // once, outside retry
    const tokenIn = resolveToken(tokenInOrSymbol);
    const tokenOut = resolveToken(tokenOutOrSymbol);
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    return withSettlementRetry('private_swap', async () => {
      await session.refreshState();
      const { swapData, outAmount } = await buildOdosSwap(
        routeAddress(tokenIn),
        amount,
        routeAddress(tokenOut),
        slippagePercent,
      );
      const h = await session.ready();
      return h.swap(
        [tokenIn, tokenOut],
        [privateSpendDelta(amount), outAmount],
        ExternalActionId.Odos,
        swapData,
        feeToken,
      );
    });
  });
}
