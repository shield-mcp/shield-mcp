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
    enforcePolicy('private_transfer', { amount, recipient: recipientShieldedAddress });
    await session.refreshState();
    const token = resolveToken(tokenOrSymbol);
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    return (await session.ready()).transfer([token], [privateSpendDelta(amount)], recipientShieldedAddress, feeToken);
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
    enforcePolicy('unshield', { amount, recipient: recipientAddress });
    await session.refreshState();
    const token = resolveToken(tokenOrSymbol);
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    const res = await (await session.ready()).withdraw([token], [privateSpendDelta(amount)], recipientAddress, !useRelayer, feeToken);
    return finalize(res);
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
 * Validated live on Base (USDC→USDT). Native ETH is supported (routed via WETH).
 * 1:1-ish/stable pairs are safest; volatile pairs rely on the Odos slippage limit.
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
    enforcePolicy('private_swap', { amount });
    await session.refreshState();
    const tokenIn = resolveToken(tokenInOrSymbol);
    const tokenOut = resolveToken(tokenOutOrSymbol);
    const { swapData, outAmount } = await buildOdosSwap(
      routeAddress(tokenIn),
      amount,
      routeAddress(tokenOut),
      slippagePercent,
    );
    const feeToken = feeTokenOrSymbol ? resolveToken(feeTokenOrSymbol).erc20TokenAddress : undefined;
    const h = await session.ready();
    return h.swap(
      [tokenIn, tokenOut],
      [privateSpendDelta(amount), outAmount],
      ExternalActionId.Odos,
      swapData,
      feeToken,
    );
  });
}
