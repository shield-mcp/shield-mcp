import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOdosSwap, odosExecutorAddress } from '../dist/odos.js';

// Base mainnet token addresses (only used as opaque strings here).
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2';

const realFetch = global.fetch;
function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: String(url), headers: opts?.headers ?? {}, body });
    return handler(String(url), body, opts);
  };
  return calls;
}
const reply = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

test.afterEach(() => {
  global.fetch = realFetch;
  delete process.env.ODOS_API_KEY;
  delete process.env.SHIELD_ODOS_ROUTE_URL;
});

test('executor address resolves (Hinkal Odos external action, Base)', () => {
  assert.match(odosExecutorAddress(), /^0x[0-9a-fA-F]{40}$/);
});

test('no local Odos key -> routes via the hosted helper; no key/secret on the wire', async () => {
  delete process.env.ODOS_API_KEY;
  process.env.SHIELD_ODOS_ROUTE_URL = 'https://helper.test/api/route';
  const calls = mockFetch((url) => {
    assert.equal(url, 'https://helper.test/api/route');
    return reply({ swapData: '0xdeadbeef', outAmount: '990000', priceImpact: 0.1 });
  });

  const out = await buildOdosSwap(USDC, 1_000_000n, USDT, 0.5);
  assert.equal(out.swapData, '0xdeadbeef');
  assert.equal(out.outAmount, 990000n);
  assert.ok(out.minOut > 0n && out.minOut <= out.outAmount);

  // exactly one call, to the helper, never directly to Odos:
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => c.url.includes('api.odos.xyz')));
  // no Odos api key header is sent from the client on the helper path:
  assert.equal(calls[0].headers['x-api-key'], undefined);
  // sends only the swap params + the SHARED executor address (no user identity):
  assert.equal(calls[0].body.userAddr.toLowerCase(), odosExecutorAddress().toLowerCase());
  assert.equal(calls[0].body.amount, '1000000');
  assert.equal(calls[0].body.chainId, 8453);
});

test('local Odos key -> queries Odos directly (quote + assemble)', async () => {
  process.env.ODOS_API_KEY = 'test-key';
  const calls = mockFetch((url) => {
    if (url.includes('/sor/quote')) return reply({ pathId: 'p1', outAmounts: ['990000'], priceImpact: 0.2 });
    if (url.includes('/sor/assemble')) return reply({ transaction: { data: '0xabc' } });
    throw new Error('unexpected url ' + url);
  });

  const out = await buildOdosSwap(USDC, 1_000_000n, USDT, 0.5);
  assert.equal(out.swapData, '0xabc');
  assert.equal(out.outAmount, 990000n);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.url.includes('api.odos.xyz')));
  assert.equal(calls[0].headers['x-api-key'], 'test-key');
});

test('price-impact guard rejects a bad route from the helper', async () => {
  delete process.env.ODOS_API_KEY;
  process.env.SHIELD_ODOS_ROUTE_URL = 'https://helper.test/api/route';
  mockFetch(() => reply({ swapData: '0xbad', outAmount: '500000', priceImpact: 9.9 }));
  await assert.rejects(() => buildOdosSwap(USDC, 1_000_000n, USDT, 0.5), /price impact/);
});

test('helper error surfaces clearly', async () => {
  delete process.env.ODOS_API_KEY;
  process.env.SHIELD_ODOS_ROUTE_URL = 'https://helper.test/api/route';
  mockFetch(() => reply({ error: 'quote failed: no route' }, 502));
  await assert.rejects(() => buildOdosSwap(USDC, 1_000_000n, USDT, 0.5), /route helper error/);
});

test('empty route from the helper is rejected', async () => {
  delete process.env.ODOS_API_KEY;
  process.env.SHIELD_ODOS_ROUTE_URL = 'https://helper.test/api/route';
  mockFetch(() => reply({ swapData: '', outAmount: '0', priceImpact: 0 }));
  await assert.rejects(() => buildOdosSwap(USDC, 1_000_000n, USDT, 0.5), /route helper error|empty route/);
});
