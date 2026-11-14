import { keccak256, stringToHex } from 'viem';

export function assertMainnetManifest(manifest) {
  if (manifest?.chainId !== 4663) throw new Error('Mainnet resolver requires manifest chain ID 4663.');
  if (!manifest.deployer || !manifest.resolverSigner || !manifest.addresses?.MarketRegistry
      || !manifest.addresses?.ResolutionAdapter || !manifest.addresses?.MLDSA44Verifier) {
    throw new Error('Mainnet deployment manifest is missing signer or resolver contract addresses.');
  }
  if (!manifest.keyValidation?.bot?.pkBlob && !manifest.deployments?.botPKBlob?.address) {
    throw new Error('Mainnet manifest is missing the registered ML-DSA bot key blob.');
  }
}

export function terminalOutcome(status) {
  if (Number(status) === 4) return 'Final YES';
  if (Number(status) === 5) return 'Final NO';
  if (Number(status) === 6) return 'Cancelled';
  if (Number(status) === 7) return 'Discarded';
  return undefined;
}

export function buildMainnetReport({ marketId, market, period, valueBps, evidenceHash }) {
  const periodId = keccak256(stringToHex(period));
  if (market.periodId.toLowerCase() !== periodId.toLowerCase()) throw new Error('Mainnet market period does not match the parsed BEA release.');
  if (!market.activated || Number(market.status) >= 4) throw new Error('Mainnet market is inactive or already terminal.');
  if (!Number.isInteger(valueBps) || valueBps < -2147483648 || valueBps > 2147483647) throw new Error('Parsed BEA value is outside the signed int32 range.');
  return {
    marketId,
    sourceId: keccak256(stringToHex('bea:core-pce:mom:first-release')),
    periodId,
    valueBps,
    evidenceHash,
    signatureExpiry: market.deadline,
  };
}
