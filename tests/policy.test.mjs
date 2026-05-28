import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforcePolicy, policyConfigured, resetPolicyStateForTests } from '../dist/policy.js';
import { shield, unshield } from '../dist/operations.js';

const clear = () => {
  delete process.env.SHIELD_RECIPIENT_ALLOWLIST;
  delete process.env.SHIELD_MAX_PER_TX;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
  resetPolicyStateForTests();
};

test('no config = unrestricted', () => {
  clear();
  assert.equal(policyConfigured(), false);
  assert.doesNotThrow(() => enforcePolicy('unshield', { amount: 10n ** 30n, recipient: '0xanything' }));
});

test('recipient allowlist blocks non-listed recipients', () => {
  clear();
  process.env.SHIELD_RECIPIENT_ALLOWLIST = '0xAAA1,0xBBB2';
  assert.equal(policyConfigured(), true);
  assert.throws(() => enforcePolicy('unshield', { recipient: '0xCCC3' }), /not in SHIELD_RECIPIENT_ALLOWLIST/);
  assert.doesNotThrow(() => enforcePolicy('unshield', { recipient: '0xaaa1' })); // case-insensitive
  clear();
});

test('per-tx cap blocks oversized amounts', () => {
  clear();
  process.env.SHIELD_MAX_PER_TX = '1000000';
  assert.throws(() => enforcePolicy('private_transfer', { amount: 2000000n }), /exceeds SHIELD_MAX_PER_TX/);
  assert.doesNotThrow(() => enforcePolicy('private_transfer', { amount: 500000n }));
  clear();
});

test('daily op limit blocks after N ops', () => {
  clear();
  process.env.SHIELD_MAX_OPS_PER_DAY = '2';
  assert.doesNotThrow(() => enforcePolicy('shield', { amount: 1n }));
  assert.doesNotThrow(() => enforcePolicy('shield', { amount: 1n }));
  assert.throws(() => enforcePolicy('shield', { amount: 1n }), /daily op limit/);
  clear();
});

test('rejected op does not burn daily budget', () => {
  clear();
  process.env.SHIELD_MAX_OPS_PER_DAY = '1';
  process.env.SHIELD_MAX_PER_TX = '10';
  assert.throws(() => enforcePolicy('unshield', { amount: 11n }), /exceeds SHIELD_MAX_PER_TX/);
  assert.doesNotThrow(() => enforcePolicy('unshield', { amount: 10n }));
  assert.throws(() => enforcePolicy('unshield', { amount: 1n }), /daily op limit/);
  clear();
});

test('operations enforce policy before touching session state', async () => {
  clear();
  process.env.SHIELD_MAX_PER_TX = '10';
  let refreshed = false;
  const session = {
    withWriteLock: (op) => op(),
    refreshState: async () => {
      refreshed = true;
    },
    ready: async () => {
      throw new Error('should not boot hinkal');
    },
  };

  await assert.rejects(() => shield(session, 'USDC', 11n), /exceeds SHIELD_MAX_PER_TX/);
  assert.equal(refreshed, false);
  clear();
});

test('recipient allowlist is case-insensitive at operation boundary', async () => {
  clear();
  const recipient = '0x00000000000000000000000000000000000000aA';
  process.env.SHIELD_RECIPIENT_ALLOWLIST = recipient.toLowerCase();
  const session = {
    withWriteLock: (op) => op(),
    refreshState: async () => undefined,
    ready: async () => ({
      withdraw: async () => '0xok',
    }),
  };

  await assert.doesNotReject(() => unshield(session, 'USDC', 1n, recipient.toUpperCase()));
  clear();
});
