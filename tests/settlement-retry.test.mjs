import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateTransfer } from '../dist/operations.js';
import { resetPolicyStateForTests } from '../dist/policy.js';

// Double-spend safety: the spend op may be retried ONLY on a pre-broadcast
// "insufficient funds" shortfall (a note from a just-relayed op not yet confirmed
// in the anonymity set). Any other error must fail immediately with NO retry, so
// nothing that might already be on-chain is ever re-issued.

function clearEnv() {
  delete process.env.SHIELD_RECIPIENT_ALLOWLIST;
  delete process.env.SHIELD_MAX_PER_TX;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
  process.env.SHIELD_SETTLE_BACKOFF_MS = '1'; // keep the test fast
  process.env.SHIELD_SETTLE_RETRIES = '3';
  resetPolicyStateForTests();
}

test.afterEach(() => {
  delete process.env.SHIELD_SETTLE_BACKOFF_MS;
  delete process.env.SHIELD_SETTLE_RETRIES;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
  resetPolicyStateForTests();
});

function session(transferImpl) {
  const calls = { refresh: 0, transfer: 0 };
  return {
    calls,
    withWriteLock: (op) => op(),
    refreshState: async () => {
      calls.refresh++;
    },
    ready: async () => ({
      transfer: async (...args) => {
        calls.transfer++;
        return transferImpl(calls.transfer, args);
      },
    }),
  };
}

test('retries a pre-broadcast "insufficient funds" and succeeds once notes settle', async () => {
  clearEnv();
  const s = session((n) => {
    if (n === 1) throw new Error('Insufficient funds'); // note not yet confirmed
    return '0xtransfer';
  });
  const tx = await privateTransfer(s, 'USDC', 1n, 'shielded-addr');
  assert.equal(tx, '0xtransfer');
  assert.equal(s.calls.transfer, 2); // exactly one spend per attempt, 1 retry
  assert.equal(s.calls.refresh, 2); // re-synced before each attempt
});

test('NEVER retries a non-shortfall error (no double-spend on a broadcast-class failure)', async () => {
  clearEnv();
  const s = session(() => {
    throw new Error('execution reverted: low-level delegate call failed');
  });
  await assert.rejects(() => privateTransfer(s, 'USDC', 1n, 'shielded-addr'), /delegate call failed/);
  assert.equal(s.calls.transfer, 1); // tried ONCE — cannot double-spend
});

test('gives up with a clear "still settling" message after exhausting retries', async () => {
  clearEnv();
  const s = session(() => {
    throw new Error('Insufficient funds');
  });
  await assert.rejects(
    () => privateTransfer(s, 'USDC', 1n, 'shielded-addr'),
    /still settling|leave headroom for the relay fee/,
  );
  assert.equal(s.calls.transfer, 4); // initial + 3 retries
});

test('enforcePolicy counts the op ONCE despite retries (daily budget not burned)', async () => {
  clearEnv();
  process.env.SHIELD_MAX_OPS_PER_DAY = '1'; // only one op allowed today
  resetPolicyStateForTests();
  const s = session((n) => {
    if (n === 1) throw new Error('Insufficient funds');
    return '0xok';
  });
  // If policy ran inside the retry, the 2nd attempt would throw "daily op limit".
  const tx = await privateTransfer(s, 'USDC', 1n, 'shielded-addr');
  assert.equal(tx, '0xok');
  assert.equal(s.calls.transfer, 2);
});
