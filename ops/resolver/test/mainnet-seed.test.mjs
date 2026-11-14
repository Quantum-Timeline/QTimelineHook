import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMainnetSeedHex } from '../src/mainnet-seed.mjs';

test('Mainnet resolver seed accepts raw 32-byte files and normalized hex secrets', () => {
  const bytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const expected = bytes.toString('hex');
  assert.equal(normalizeMainnetSeedHex(bytes), expected);
  assert.equal(normalizeMainnetSeedHex(`0x${expected}`), expected);
  assert.equal(normalizeMainnetSeedHex(expected), expected);
});

test('Mainnet resolver seed rejects malformed inputs', () => {
  assert.throws(() => normalizeMainnetSeedHex(Buffer.alloc(31)), /exactly 32 bytes/);
  assert.throws(() => normalizeMainnetSeedHex('not-hex'), /exactly 32 bytes/);
});
