import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTestnetManifest, buildTestnetReport, terminalOutcome } from '../src/testnet-report.mjs';

const manifest = {
  chainId: 46630,
  resolverSigner: '0x0000000000000000000000000000000000000001',
  addresses: {
    MarketRegistry: '0x0000000000000000000000000000000000000002',
    ResolutionAdapter: '0x0000000000000000000000000000000000000003',
  },
};
const market = {
  activated: true,
  periodId: '0xb963dcb188a3ebf5e0a31e6e0c952d1df2e3a3f8001f82fcdf264bbee0c9e8d8',
  status: 2,
  thresholdBps: 30,
  deadline: 1_800_000_000n,
};

test('testnet resolver refuses non-testnet manifests', () => {
  assert.throws(() => assertTestnetManifest({ ...manifest, chainId: 4663 }), /testnet-only.*46630/);
});

test('retry recognizes final chain states without preparing another report', () => {
  assert.equal(terminalOutcome(4), 'Final YES');
  assert.equal(terminalOutcome(5), 'Final NO');
  assert.equal(terminalOutcome(2), undefined);
});

test('report is bound to the market period and production parser value', () => {
  assertTestnetManifest(manifest);
  const report = buildTestnetReport({
    marketId: `0x${'11'.repeat(32)}`,
    market,
    period: '2026-07',
    valueBps: 20,
    evidenceHash: `0x${'22'.repeat(32)}`,
  });
  assert.equal(report.valueBps, 20);
  assert.equal(report.periodId, market.periodId);
  assert.equal(report.signatureExpiry, market.deadline);
});
