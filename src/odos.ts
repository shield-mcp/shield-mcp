import path from 'node:path';
import { createRequire } from 'node:module';
import { ExternalActionId } from '@hinkal/common';
import { BASE_CHAIN_ID } from './hinkal.js';

/**
 * Odos aggregator integration for private swaps. The server fetches the optimal
 * route + router calldata; that calldata is the `swapData` Hinkal's swap()
 * executes (via the Odos external-action contract) before re-shielding the
 * output. The Odos key is server-side infra (ODOS_API_KEY) — one key, all users.
 */

// getExternalSwapAddress is internal to @hinkal/common (not in its exports map);
// resolve it by absolute path. Project is CommonJS so createRequire(__filename) works.
const req = createRequire(__filename);
const hinkalRoot = path.dirname(req.resolve('@hinkal/common'));
const { getExternalSwapAddress } = req(
  path.join(hinkalRoot, 'functions/pre-transaction/getExternalSwapAddress.cjs'),
) as { getExternalSwapAddress: (chainId: number, action: unknown) => string };

const ODOS_QUOTE = 'https://api.odos.xyz/sor/quote/v2';
const ODOS_ASSEMBLE = 'https://api.odos.xyz/sor/assemble';

/** The Hinkal Odos external-action contract — executes the swap, receives output. */
export function odosExecutorAddress(): string {
  return getExternalSwapAddress(BASE_CHAIN_ID, ExternalActionId.Odos);
}

/**
 * Build the Odos route + calldata for inputToken -> outputToken.
 * Returns the swapData (router calldata) and the quoted output amount.
 */
// Hard ceiling on slippage a caller can request, and on tolerated price impact
// (protects against illiquid/volatile routes & MEV). Both overridable via env.
const MAX_SLIPPAGE_PERCENT = Number(process.env.SHIELD_MAX_SLIPPAGE_PERCENT ?? 3);
const MAX_PRICE_IMPACT_PERCENT = Number(process.env.SHIELD_MAX_PRICE_IMPACT_PERCENT ?? 5);

export async function buildOdosSwap(
  inputTokenAddress: string,
  amount: bigint,
  outputTokenAddress: string,
  slippagePercent = 0.5,
): Promise<{ swapData: string; outAmount: bigint; minOut: bigint }> {
  const apiKey = process.env.ODOS_API_KEY;
  if (!apiKey) throw new Error('ODOS_API_KEY not set on the server');

  // Clamp slippage to a sane range — a caller can't ask for an unsafe limit.
  const slippage = Math.min(Math.max(slippagePercent, 0.05), MAX_SLIPPAGE_PERCENT);
  const userAddr = odosExecutorAddress();
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };

  const quoteRes = await fetch(ODOS_QUOTE, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chainId: BASE_CHAIN_ID,
      inputTokens: [{ tokenAddress: inputTokenAddress, amount: amount.toString() }],
      outputTokens: [{ tokenAddress: outputTokenAddress, proportion: 1 }],
      userAddr,
      slippageLimitPercent: slippage, // Odos enforces this min-out in the router calldata on-chain
      disableRFQs: true,
      compact: true,
    }),
  });
  const quote = (await quoteRes.json()) as {
    pathId?: string;
    outAmounts?: string[];
    priceImpact?: number;
    detail?: string;
  };
  if (!quote.pathId) throw new Error(`odos quote failed: ${quote.detail ?? JSON.stringify(quote).slice(0, 160)}`);

  // Reject illiquid / manipulated routes before committing funds.
  const impact = typeof quote.priceImpact === 'number' ? Math.abs(quote.priceImpact) : 0;
  if (impact > MAX_PRICE_IMPACT_PERCENT) {
    throw new Error(
      `swap aborted: price impact ${impact.toFixed(2)}% exceeds the ${MAX_PRICE_IMPACT_PERCENT}% limit (illiquid/volatile route)`,
    );
  }

  const asmRes = await fetch(ODOS_ASSEMBLE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userAddr, pathId: quote.pathId, simulate: false }),
  });
  const asm = (await asmRes.json()) as { transaction?: { data?: string } };
  const swapData = asm?.transaction?.data;
  if (!swapData) throw new Error(`odos assemble failed: ${JSON.stringify(asm).slice(0, 160)}`);

  const outAmount = BigInt(quote.outAmounts?.[0] ?? '0');
  // Min acceptable output given slippage (Odos also enforces this on-chain).
  const minOut = outAmount - (outAmount * BigInt(Math.round(slippage * 100))) / 10_000n;
  return { swapData, outAmount, minOut };
}
