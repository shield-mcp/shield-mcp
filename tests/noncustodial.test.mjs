import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { Wallet } from 'ethers';
import { shield, privateTransfer, privateSwap, unshield } from '../dist/operations.js';
import { resetPolicyStateForTests } from '../dist/policy.js';

const originalFetch = globalThis.fetch;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const originalOdosKey = process.env.ODOS_API_KEY;
const originalRouteUrl = process.env.SHIELD_ODOS_ROUTE_URL;

function clearPolicyEnv() {
  delete process.env.SHIELD_RECIPIENT_ALLOWLIST;
  delete process.env.SHIELD_MAX_PER_TX;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
  if (originalOdosKey == null) delete process.env.ODOS_API_KEY;
  else process.env.ODOS_API_KEY = originalOdosKey;
  if (originalRouteUrl == null) delete process.env.SHIELD_ODOS_ROUTE_URL;
  else process.env.SHIELD_ODOS_ROUTE_URL = originalRouteUrl;
  clearPolicyEnv();
  resetPolicyStateForTests();
});

// Patch every outbound channel (node http/https + global fetch). On each call,
// assert the local private key NEVER appears. Optionally assert no shield-operated
// host is contacted — true for the self-host path; relaxed for the hosted-helper
// path, which fetches PUBLIC route data only and still must never see the key.
function installWireCapture(privateKey, { forbidShieldHost = true } = {}) {
  const key = privateKey.toLowerCase();
  const keyNoPrefix = key.slice(2);
  const captures = [];
  const scan = (channel, value) => {
    const text = String(value ?? '').toLowerCase();
    captures.push({ channel, text });
    assert.equal(text.includes(key), false, `${channel} leaked prefixed private key`);
    assert.equal(text.includes(keyNoPrefix), false, `${channel} leaked unprefixed private key`);
    if (forbidShieldHost) {
      assert.equal(/shieldmcp\.sh|shield-mcp|fly\.dev/.test(text), false, `${channel} contacted shield-operated host`);
    }
  };

  for (const [mod, original] of [[http, originalHttpRequest], [https, originalHttpsRequest]]) {
    mod.request = function patchedRequest(...args) {
      scan('node-request-args', JSON.stringify(args));
      const req = original.apply(this, args);
      const write = req.write.bind(req);
      req.write = (chunk, ...rest) => {
        scan('node-request-body', chunk);
        return write(chunk, ...rest);
      };
      return req;
    };
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    scan('fetch', `${url} ${JSON.stringify(init.headers ?? {})} ${typeof init.body === 'string' ? init.body : ''}`);
    if (url.includes('/api/route')) {
      return Response.json({ swapData: '0x1234', outAmount: '990000', priceImpact: 0.01 });
    }
    if (url.includes('/quote/')) {
      return Response.json({ pathId: 'path-1', outAmounts: ['990000'], priceImpact: 0.01 });
    }
    if (url.includes('/assemble')) {
      return Response.json({ transaction: { data: '0x1234' } });
    }
    return Response.json({});
  };

  return captures;
}

function fakeSession() {
  const calls = [];
  const token = { erc20TokenAddress: '0x0000000000000000000000000000000000000001' };
  const h = {
    deposit: async (...args) => {
      calls.push(['deposit', args]);
      return '0xdeposit';
    },
    transfer: async (...args) => {
      calls.push(['transfer', args]);
      return '0xtransfer';
    },
    withdraw: async (...args) => {
      calls.push(['withdraw', args]);
      return '0xwithdraw';
    },
    swap: async (...args) => {
      calls.push(['swap', args]);
      return '0xswap';
    },
  };
  return {
    calls,
    token,
    withWriteLock: (op) => op(),
    refreshState: async () => {
      calls.push(['refresh']);
    },
    ready: async () => h,
  };
}

describe('non-custodial outbound assertion', () => {
  it('self-host path (own Odos key): key never on the wire, no shield-operated host contacted', async () => {
    clearPolicyEnv();
    const privateKey = Wallet.createRandom().privateKey;
    const captures = installWireCapture(privateKey, { forbidShieldHost: true });
    process.env.ODOS_API_KEY = 'odos-test-key'; // self-host: route fetched directly from the aggregator
    delete process.env.SHIELD_ODOS_ROUTE_URL;
    const session = fakeSession();

    await shield(session, 'USDC', 1n);
    await privateTransfer(session, 'USDC', 1n, `1,${'0x' + '1'.repeat(62)},${'0x' + '2'.repeat(64)},3,4`);
    await unshield(session, 'USDC', 1n, '0x0000000000000000000000000000000000000001');
    await privateSwap(session, 'USDC', 1n, 'USDT');

    assert.equal(captures.some((c) => c.text.includes('api.odos.xyz')), true);
    assert.equal(session.calls.some(([name]) => name === 'deposit'), true);
    assert.equal(session.calls.some(([name]) => name === 'transfer'), true);
    assert.equal(session.calls.some(([name]) => name === 'withdraw'), true);
    assert.equal(session.calls.some(([name]) => name === 'swap'), true);
  });

  it('default path (hosted route helper): the helper is contacted but the key still never leaves', async () => {
    clearPolicyEnv();
    const privateKey = Wallet.createRandom().privateKey;
    // The helper IS a shield-operated host — allow contacting it, but the key must never appear.
    const captures = installWireCapture(privateKey, { forbidShieldHost: false });
    delete process.env.ODOS_API_KEY; // no local key -> route via the hosted helper
    delete process.env.SHIELD_ODOS_ROUTE_URL; // default: https://shieldmcp.sh/api/route
    const session = fakeSession();

    await privateSwap(session, 'USDC', 1n, 'USDT');

    assert.equal(captures.some((c) => c.text.includes('shieldmcp.sh')), true); // helper was contacted
    assert.equal(captures.some((c) => c.text.includes('api.odos.xyz')), false); // client never hits Odos directly
    assert.equal(session.calls.some(([name]) => name === 'swap'), true); // swap still executed via the pool
  });
});
