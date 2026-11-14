import { keccak256, stringToHex } from 'viem';
import { IPO_SOURCE_ID } from './sec.mjs';

export function assertIpoManifest(manifest) {
  if (manifest?.chainId !== 4663) throw new Error('The IPO resolver requires a manifest for chain ID 4663.');
  if (manifest.system !== 'anthropic-ipo-pricing') throw new Error('This manifest is not the Anthropic IPO pricing deployment.');
  const a = manifest.addresses ?? {};
  if (!manifest.deployer || !manifest.resolverSigner || !a.IpoMarketRegistry || !a.IpoResolutionAdapter || !a.MLDSA44Verifier) {
    throw new Error('IPO deployment manifest is missing signer or resolver contract addresses.');
  }
  if (!manifest.keyValidation?.bot?.pkBlob && !manifest.deployments?.botPKBlob?.address) {
    throw new Error('IPO manifest is missing the registered ML-DSA bot key blob.');
  }
}

export function ipoSourceId() {
  return keccak256(stringToHex(IPO_SOURCE_ID));
}

/** Builds the signed report struct for the final offering price, expressed in US cents. */
export function buildIpoReport({ marketId, market, period, priceCents, evidenceHash }) {
  const periodId = keccak256(stringToHex(period));
  if (market.periodId.toLowerCase() !== periodId.toLowerCase()) throw new Error('IPO market period does not match the configured period.');
  if (!market.activated || Number(market.status) >= 4) throw new Error('IPO market is inactive or already terminal.');
  if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 2147483647) throw new Error('Parsed offering price is outside the positive int32 range.');
  return {
    marketId,
    sourceId: ipoSourceId(),
    periodId,
    valueBps: priceCents,
    evidenceHash,
    signatureExpiry: market.deadline,
  };
}
