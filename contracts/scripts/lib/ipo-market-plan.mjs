// Schedule rules for the Anthropic IPO pricing market. The seed budget, ticks and liquidity math are shared with Core PCE
// (mainnet-market-plan.mjs); only the timeline differs, because an IPO is priced in the evening and its final prospectus follows.
const UINT64_MAX = (1n << 64n) - 1n;

/**
 * cutoffAt: last moment of trading, chosen to fall before the offering is priced.
 * releaseAt: earliest report, cutoffAt + releaseDelay (the final prospectus is filed after pricing).
 * deadline: releaseAt + resolutionWindow, after which anyone can cancel.
 * The registry requires activation at least `minimumTradingWindow` before cutoffAt.
 */
export function ipoSchedule({ now, cutoffAt, releaseDelay, resolutionWindow, minimumTradingWindow, opensAt }) {
  const current = BigInt(now);
  const cutoff = BigInt(cutoffAt);
  const delay = BigInt(releaseDelay);
  const window = BigInt(resolutionWindow);
  const minimum = BigInt(minimumTradingWindow);
  const opens = opensAt === undefined ? current + 3_600n : BigInt(opensAt);
  const release = cutoff + delay;
  const deadline = release + window;
  if (!(current < opens && opens + minimum <= cutoff && cutoff < release && release < deadline && deadline <= UINT64_MAX)) {
    throw new Error("Schedule leaves less than the minimum trading window between opensAt and the cutoff; move the cutoff later or lower the minimum at deploy time");
  }
  return { opensAt: opens, cutoffAt: cutoff, releaseAt: release, deadline };
}

/** Threshold input is dollars (e.g. "74" or "74.50"); the contract stores US cents. */
export function parsePriceCents(text) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(text))) throw new Error("Threshold must be a dollar amount with at most two decimals, for example 74 or 74.50");
  const [whole, frac = ""] = String(text).split(".");
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  if (cents <= 0n || cents > 2_147_483_647n) throw new Error("Threshold is outside the supported range");
  return Number(cents);
}
