import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  depositDelta,
  privateSpendDelta,
} from '../dist/operations.js';
import {
  isValidHinkalPrivateAddress,
  parseBoolean,
  parsePositiveBaseUnits,
  requireString,
  validateHexCalldata,
  validatePublicAddress,
  validateSwapAction,
} from '../dist/validation.js';
import { resolveToken } from '../dist/hinkal.js';

describe('amount and sign handling', () => {
  it('parses only positive decimal base-unit amounts', () => {
    assert.equal(parsePositiveBaseUnits('1'), 1n);
    assert.equal(parsePositiveBaseUnits('1000000'), 1000000n);
    assert.throws(() => parsePositiveBaseUnits('0'), /greater than zero/);
    assert.throws(() => parsePositiveBaseUnits('-1'), /positive decimal integer/);
    assert.throws(() => parsePositiveBaseUnits('1.5'), /positive decimal integer/);
    assert.throws(() => parsePositiveBaseUnits('1e6'), /positive decimal integer/);
  });

  it('keeps Hinkal deltas explicit', () => {
    assert.equal(depositDelta(7n), 7n);
    assert.equal(privateSpendDelta(7n), -7n);
  });
});

describe('token and recipient validation', () => {
  it('resolves Base tokens by symbol and address', () => {
    const usdc = resolveToken('USDC');
    assert.equal(resolveToken(usdc.erc20TokenAddress).erc20TokenAddress.toLowerCase(), usdc.erc20TokenAddress.toLowerCase());
  });

  it('validates public EVM recipients', () => {
    assert.equal(validatePublicAddress('0x0000000000000000000000000000000000000001'), '0x0000000000000000000000000000000000000001');
    assert.throws(() => validatePublicAddress('not-an-address'), /valid EVM address/);
  });

  it('validates Hinkal shielded recipient shape', () => {
    const recipient = `1,${'0x' + '1'.repeat(62)},${'0x' + '2'.repeat(64)},3,4`;
    assert.equal(isValidHinkalPrivateAddress(recipient), true);
    assert.equal(isValidHinkalPrivateAddress(`https://example.com/payment/${recipient}`), false);
    assert.equal(isValidHinkalPrivateAddress('0x0000000000000000000000000000000000000001'), false);
  });
});

describe('MCP input validation helpers', () => {
  it('requires strings instead of coercing arbitrary input', () => {
    assert.equal(requireString({ token: ' USDC ' }, 'token'), 'USDC');
    assert.throws(() => requireString({ token: 123 }, 'token'), /must be a string/);
  });

  it('requires real booleans', () => {
    assert.equal(parseBoolean({}, 'useRelayer', true), true);
    assert.equal(parseBoolean({ useRelayer: false }, 'useRelayer', true), false);
    assert.throws(() => parseBoolean({ useRelayer: 'false' }, 'useRelayer', true), /must be a boolean/);
  });

  it('validates swap action and calldata before hitting Hinkal', () => {
    assert.equal(validateSwapAction('Odos'), 'Odos');
    assert.throws(() => validateSwapAction('EvilRouter'), /action must be one/);
    assert.equal(validateHexCalldata('0x1234abcd'), '0x1234abcd');
    assert.throws(() => validateHexCalldata('0x123'), /even-length hex/);
    assert.throws(() => validateHexCalldata('not-hex'), /0x-prefixed/);
  });
});
