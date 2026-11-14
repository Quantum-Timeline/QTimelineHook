import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, stringToHex } from 'viem';
import { assertMainnetManifest, buildMainnetReport, terminalOutcome } from '../src/mainnet-report.mjs';

const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const manifest = {
  chainId: 4663,
  deployer: address(1),
  resolverSigner: address(2),
  addresses: { MarketRegistry: address(3), ResolutionAdapter: address(4), MLDSA44Verifier: address(5) },
  keyValidation: { bot: { pkBlob: address(6) } },
};
const market = {
  periodId: keccak256(stringToHex('2026-10')),
  deadline: 1_800_000_000n,
  thresholdBps: 30,
  status: 2,
  activated: true,
};

test('mainnet resolver refuses non-mainnet or incomplete deployment manifests', () => {
  assert.doesNotThrow(() => assertMainnetManifest(manifest));
  assert.throws(() => assertMainnetManifest({ ...manifest, chainId: 46630 }), /mainnet.*4663/i);
  assert.throws(() => assertMainnetManifest({ ...manifest, keyValidation: {} }), /ML-DSA bot key blob/i);
});

test('mainnet report is bound to active market period, threshold input and deadline', () => {
  const report = buildMainnetReport({ marketId: `0x${'11'.repeat(32)}`, market, period: '2026-10', valueBps: 30, evidenceHash: `0x${'22'.repeat(32)}` });
  assert.equal(report.marketId, `0x${'11'.repeat(32)}`);
  assert.equal(report.periodId, market.periodId);
  assert.equal(report.valueBps, 30);
  assert.equal(report.signatureExpiry, market.deadline);
  assert.throws(() => buildMainnetReport({ marketId: report.marketId, market, period: '2026-09', valueBps: 30, evidenceHash: report.evidenceHash }), /period/i);
  assert.throws(() => buildMainnetReport({ marketId: report.marketId, market: { ...market, activated: false }, period: '2026-10', valueBps: 30, evidenceHash: report.evidenceHash }), /inactive|terminal/i);
  assert.throws(() => buildMainnetReport({ marketId: report.marketId, market: { ...market, status: 5 }, period: '2026-10', valueBps: 30, evidenceHash: report.evidenceHash }), /inactive|terminal/i);
  assert.throws(() => buildMainnetReport({ marketId: report.marketId, market, period: '2026-10', valueBps: 2 ** 31, evidenceHash: report.evidenceHash }), /int32/i);
});

test('mainnet resolver recognizes final and non-final registry states', () => {
  assert.equal(terminalOutcome(4), 'Final YES');
  assert.equal(terminalOutcome(5), 'Final NO');
  assert.equal(terminalOutcome(6), 'Cancelled');
  assert.equal(terminalOutcome(7), 'Discarded');
  assert.equal(terminalOutcome(2), undefined);
});
