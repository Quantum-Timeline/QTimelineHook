import { keccak256, stringToHex } from 'viem';

const TESTNET_CHAIN_ID = 46630;

export function assertTestnetManifest(manifest) {
  if (manifest?.chainId !== TESTNET_CHAIN_ID) throw new Error(`Resolver is testnet-only; expected chain ID ${TESTNET_CHAIN_ID}.`);
  if (!manifest.addresses?.MarketRegistry || !manifest.addresses?.ResolutionAdapter || !manifest.resolverSigner) {
    throw new Error('Testnet manifest is missing resolver, registry, or signer configuration.');
  }
}

export function terminalOutcome(status) {
  if (Number(status) === 4) return 'Final YES';
  if (Number(status) === 5) return 'Final NO';
  if (Number(status) === 6) return 'Cancelled';
  if (Number(status) === 7) return 'Discarded';
  return undefined;
}

export function buildTestnetReport({ marketId, market, period, valueBps, evidenceHash }) {
  const expectedPeriodId = keccak256(stringToHex(period));
  if (market.periodId.toLowerCase() !== expectedPeriodId.toLowerCase()) throw new Error('Testnet market period does not match the parsed BEA fixture.');
  if (!market.activated || Number(market.status) >= 4) throw new Error('Testnet market is inactive or already terminal.');
  if (!Number.isInteger(valueBps) || valueBps < -2147483648 || valueBps > 2147483647) throw new Error('Parsed BEA value is outside the signed int32 range.');
  return { marketId, sourceId: keccak256(stringToHex('bea:core-pce:mom:first-release')), periodId: expectedPeriodId, valueBps, evidenceHash, signatureExpiry: market.deadline };
}
