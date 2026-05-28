import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanErrorMessage } from '../dist/errors.js';

describe('error redaction', () => {
  it('redacts common secret shapes from returned or logged errors', () => {
    const message = cleanErrorMessage(
      new Error('failed with 0x' + 'a'.repeat(64) + ' and Bearer abc.def?ghi at https://rpc/?api_key=secret'),
    );
    assert.equal(message.includes('a'.repeat(64)), false);
    assert.equal(message.includes('abc.def?ghi'), false);
    assert.equal(message.includes('api_key=secret'), false);
  });
});
