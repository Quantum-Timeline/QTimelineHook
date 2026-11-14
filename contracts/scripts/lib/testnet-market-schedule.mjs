const UINT64_MAX = (1n << 64n) - 1n;

export function testnetMarketSchedule({ now, shortTestnet = false, releaseAtOverride }) {
  const current = BigInt(now);
  const opensAt = current + (shortTestnet ? 60n : 3600n);
  const releaseDelay = shortTestnet ? 10n : 300n;
  const resolutionWindow = shortTestnet ? 120n : 172800n;
  if (shortTestnet && releaseAtOverride !== undefined) {
    throw new Error('An exact external release schedule requires the long-window testnet stack.');
  }
  if (releaseAtOverride !== undefined && !/^\d+$/.test(String(releaseAtOverride))) {
    throw new Error('QTIMELINE_TESTNET_RELEASE_AT must be a Unix timestamp in seconds.');
  }
  const releaseAt = releaseAtOverride === undefined
    ? current + (shortTestnet ? 370n : 172800n)
    : BigInt(releaseAtOverride);
  const cutoffAt = releaseAt - releaseDelay;
  const deadline = releaseAt + resolutionWindow;
  const minimumTradingWindow = shortTestnet ? 60n : 86400n;
  if (!(current < opensAt && opensAt + minimumTradingWindow <= cutoffAt && cutoffAt + releaseDelay === releaseAt && releaseAt < deadline && deadline <= UINT64_MAX)) {
    throw new Error('Testnet market schedule window is invalid or too short for activation.');
  }
  return { opensAt, cutoffAt, releaseAt, deadline };
}
