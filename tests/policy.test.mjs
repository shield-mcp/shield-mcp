import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforcePolicy, policyConfigured } from '../dist/policy.js';

const clear = () => {
  delete process.env.SHIELD_RECIPIENT_ALLOWLIST;
  delete process.env.SHIELD_MAX_PER_TX;
  delete process.env.SHIELD_MAX_OPS_PER_DAY;
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
