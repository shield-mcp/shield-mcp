import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateSwap } from '../dist/operations.js';

// Base: native ETH wraps to WETH. The aggregator route MUST target WETH, never
// the native zero address — otherwise Hinkal's on-chain wrap/swap reverts
// ("low-level delegate call failed").
const WETH = '0x4200000000000000000000000000000000000006';
const ZERO = '0x0000000000000000000000000000000000000000';
const realFetch = global.fetch;

function clearEnv() {
  delete process.env.ODOS_API_KEY;
  delete process.env.SHIELD_RECIPIENT_ALLOWLIST;
  delete process.env.SHIELD_MAX_PER_TX;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
  process.env.SHIELD_ODOS_ROUTE_URL = 'https://helper.test/api/route';
}

function fakeSession() {
  const calls = [];
  return {
    calls,
    withWriteLock: (op) => op(),
    refreshState: async () => {},
    ready: async () => ({
      swap: async (...args) => {
        calls.push(args);
        return '0xswap';
      },
    }),
  };
}

// Capture the route request the client sends to the helper.
function captureRouteBody(route = { swapData: '0xabc', outAmount: '990000', priceImpact: 0.01 }) {
  let body;
  global.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => route };
  };
  return () => body;
}

test.afterEach(() => {
  global.fetch = realFetch;
  delete process.env.SHIELD_ODOS_ROUTE_URL;
});

test('private_swap with native ETH as input routes the quote through WETH (not the zero address)', async () => {
  clearEnv();
  const getBody = captureRouteBody();
  const session = fakeSession();

  await privateSwap(session, 'ETH', 10n ** 15n, 'USDC'); // 0.001 ETH -> USDC

  const body = getBody();
  assert.equal(body.inputToken.toLowerCase(), WETH.toLowerCase());
  assert.notEqual(body.inputToken, ZERO);
  assert.equal(session.calls.length, 1); // swap still executed via the native token objects
});

test('private_swap to native ETH routes the quote output through WETH', async () => {
  clearEnv();
  const getBody = captureRouteBody({ swapData: '0xabc', outAmount: '1000000000000000', priceImpact: 0.01 });
  const session = fakeSession();

  await privateSwap(session, 'USDC', 1_000_000n, 'ETH'); // 1 USDC -> ETH

  const body = getBody();
  assert.equal(body.outputToken.toLowerCase(), WETH.toLowerCase());
  assert.notEqual(body.outputToken, ZERO);
});

test('ERC-20 pairs are unchanged (USDC keeps its own address)', async () => {
  clearEnv();
  const getBody = captureRouteBody();
  const session = fakeSession();

  await privateSwap(session, 'USDC', 1_000_000n, 'USDT');

  const body = getBody();
  assert.equal(body.inputToken.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  assert.equal(body.outputToken.toLowerCase(), '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2');
});
