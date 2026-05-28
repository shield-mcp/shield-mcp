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
  clearPolicyEnv();
  resetPolicyStateForTests();
});

function installWireCapture(privateKey) {
  const key = privateKey.toLowerCase();
  const keyNoPrefix = key.slice(2);
  const captures = [];
  const scan = (channel, value) => {
    const text = String(value ?? '').toLowerCase();
    captures.push({ channel, text });
    assert.equal(text.includes(key), false, `${channel} leaked prefixed private key`);
    assert.equal(text.includes(keyNoPrefix), false, `${channel} leaked unprefixed private key`);
    assert.equal(/shieldmcp\.sh|shield-mcp|fly\.dev/.test(text), false, `${channel} contacted shield-operated host`);
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
  it('does not put the local private key or shield-operated hosts on the wire for mocked fund-moving flows', async () => {
    clearPolicyEnv();
    const privateKey = Wallet.createRandom().privateKey;
    const captures = installWireCapture(privateKey);
    process.env.ODOS_API_KEY = 'odos-test-key';
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
});
