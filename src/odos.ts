import path from 'node:path';
import { createRequire } from 'node:module';
import { ExternalActionId } from '@hinkal/common';
import { BASE_CHAIN_ID } from './hinkal.js';

/**
 * Odos aggregator integration for private swaps. private_swap needs the optimal
 * route + router calldata; that calldata is the `swapData` Hinkal's swap()
 * executes (via the Odos external-action contract) before re-shielding the output.
 *
 * Two routing modes, SAME validation, neither ever touches the private key:
 *   • default  — no local key: fetch the route from the hosted helper, which
 *     holds ONE operator Odos key server-side. Users get private_swap without
 *     each needing their own Odos key. The helper sees only the swap params +
 *     Hinkal's shared executor address — never the user's key, identity, or funds.
 *   • self-host — ODOS_API_KEY set locally: query Odos directly, zero third party.
 *
 * Either way the route is PUBLIC data; proofs + signing happen later, locally, in
 * the SDK. The client re-validates every route (price-impact guard, min-out)
 * before any funds move, and Hinkal enforces the declared output delta on-chain —
 * so even a malicious route can't redirect funds, only (within slippage) the rate.
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

// Hard ceiling on slippage a caller can request, and on tolerated price impact
// (protects against illiquid/volatile routes & MEV). Both overridable via env.
const MAX_SLIPPAGE_PERCENT = Number(process.env.SHIELD_MAX_SLIPPAGE_PERCENT ?? 3);
const MAX_PRICE_IMPACT_PERCENT = Number(process.env.SHIELD_MAX_PRICE_IMPACT_PERCENT ?? 5);

// Read lazily so it's configurable at runtime (and testable) without a rebuild.
function routeHelperUrl(): string {
  return process.env.SHIELD_ODOS_ROUTE_URL || 'https://shieldmcp.sh/api/route';
}

/** The Hinkal Odos external-action contract — executes the swap, receives output. */
export function odosExecutorAddress(): string {
  return getExternalSwapAddress(BASE_CHAIN_ID, ExternalActionId.Odos);
}

type OdosRoute = { swapData: string; outAmount: bigint; priceImpact: number };

/**
 * Build the Odos route + calldata for inputToken -> outputToken.
 * Returns the swapData (router calldata), the quoted output amount, and the
 * min acceptable output given slippage.
 */
export async function buildOdosSwap(
  inputTokenAddress: string,
  amount: bigint,
  outputTokenAddress: string,
  slippagePercent = 0.5,
): Promise<{ swapData: string; outAmount: bigint; minOut: bigint }> {
  // Clamp slippage to a sane range — a caller can't ask for an unsafe limit.
  const slippage = Math.min(Math.max(slippagePercent, 0.05), MAX_SLIPPAGE_PERCENT);
  const userAddr = odosExecutorAddress();

  const apiKey = process.env.ODOS_API_KEY;
  const route = apiKey
    ? await routeDirect(inputTokenAddress, amount, outputTokenAddress, slippage, userAddr, apiKey)
    : await routeViaHelper(inputTokenAddress, amount, outputTokenAddress, slippage, userAddr);

  // NEVER trust a remote route blindly: re-assert the price-impact guard on the
  // client before committing funds, regardless of where the route came from.
  if (route.priceImpact > MAX_PRICE_IMPACT_PERCENT) {
    throw new Error(
      `swap aborted: price impact ${route.priceImpact.toFixed(2)}% exceeds the ${MAX_PRICE_IMPACT_PERCENT}% limit (illiquid/volatile route)`,
    );
  }
  if (!route.swapData || route.outAmount <= 0n) {
    throw new Error('swap aborted: aggregator returned an empty route');
  }

  // Min acceptable output given slippage (Odos also enforces this on-chain).
  const minOut = route.outAmount - (route.outAmount * BigInt(Math.round(slippage * 100))) / 10_000n;
  return { swapData: route.swapData, outAmount: route.outAmount, minOut };
}

/** Self-host path: query Odos directly. quote -> price-impact guard -> assemble. */
async function routeDirect(
  inputTokenAddress: string,
  amount: bigint,
  outputTokenAddress: string,
  slippage: number,
  userAddr: string,
  apiKey: string,
): Promise<OdosRoute> {
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

  const impact = typeof quote.priceImpact === 'number' ? Math.abs(quote.priceImpact) : 0;
  // Reject illiquid / manipulated routes before spending an assemble call.
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

  return { swapData, outAmount: BigInt(quote.outAmounts?.[0] ?? '0'), priceImpact: impact };
}

/**
 * Default path: ask the hosted helper for the route. One POST; the operator's
 * Odos key stays server-side. No key, identity, or funds are sent — only the
 * swap params and Hinkal's shared executor address.
 */
async function routeViaHelper(
  inputTokenAddress: string,
  amount: bigint,
  outputTokenAddress: string,
  slippage: number,
  userAddr: string,
): Promise<OdosRoute> {
  const url = routeHelperUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chainId: BASE_CHAIN_ID,
        inputToken: inputTokenAddress,
        outputToken: outputTokenAddress,
        amount: amount.toString(),
        slippage,
        userAddr,
      }),
    });
  } catch (e) {
    throw new Error(
      `private_swap route helper unreachable (${url}). Set ODOS_API_KEY to route directly, or check connectivity. (${(e as Error).message})`,
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    swapData?: string;
    outAmount?: string;
    priceImpact?: number;
    error?: string;
  };
  if (!res.ok || data.error || !data.swapData) {
    throw new Error(`private_swap route helper error: ${data.error ?? `HTTP ${res.status}`}`);
  }

  return {
    swapData: data.swapData,
    outAmount: BigInt(data.outAmount ?? '0'),
    priceImpact: typeof data.priceImpact === 'number' ? Math.abs(data.priceImpact) : 0,
  };
}
