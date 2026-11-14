// Pure planning math for the first Mainnet market: schedule, seed budget, v4 prices, ticks and liquidity.
// Everything here is deterministic BigInt arithmetic so it can be unit tested against Foundry vectors.
export const Q96 = 1n << 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const UINT64_MAX = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

const TICK_MULTIPLIERS = [
  [0x2, 0xfff97272373d413259a46990580e213an], [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n], [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n], [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n], [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n], [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n], [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
];

export function sqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error("tick out of range");
  const abs = Math.abs(tick);
  let ratio = (abs & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  for (const [bit, mul] of TICK_MULTIPLIERS) if ((abs & bit) !== 0) ratio = (ratio * mul) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

export function bigintSqrt(value) {
  if (value < 0n) throw new Error("sqrt of negative");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + value / x) >> 1n; }
  return x;
}

/** sqrt(amount1 / amount0) in Q96, matching OpenZeppelin Math.sqrt(mulDiv(a1, 2^192, a0)). */
export function sqrtPriceX96(amount1, amount0) {
  if (amount0 <= 0n || amount1 <= 0n) throw new Error("price amounts must be positive");
  return bigintSqrt((amount1 << 192n) / amount0);
}

/** Largest tick whose sqrt ratio is <= sqrtP. */
export function tickAtSqrtPrice(sqrtP) {
  let guess = Math.floor(Math.log(Number(sqrtP) / Number(Q96)) * 2 / Math.log(1.0001));
  guess = Math.max(MIN_TICK, Math.min(MAX_TICK - 1, guess));
  while (sqrtRatioAtTick(guess) > sqrtP) guess -= 1;
  while (guess < MAX_TICK - 1 && sqrtRatioAtTick(guess + 1) <= sqrtP) guess += 1;
  return guess;
}

export const floorToSpacing = (tick, spacing) => Math.floor(tick / spacing) * spacing || 0;
export const ceilToSpacing = (tick, spacing) => Math.ceil(tick / spacing) * spacing || 0;

/** Port of v4-periphery LiquidityAmounts.getLiquidityForAmounts. */
export function liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const l0 = (lo, hi) => (amount0 * ((lo * hi) / Q96)) / (hi - lo);
  const l1 = (lo, hi) => (amount1 * Q96) / (hi - lo);
  if (sqrtP <= sqrtA) return l0(sqrtA, sqrtB);
  if (sqrtP < sqrtB) { const a = l0(sqrtP, sqrtB); const b = l1(sqrtA, sqrtP); return a < b ? a : b; }
  return l1(sqrtA, sqrtB);
}

/** Token amounts needed for liquidity L at price sqrtP inside [sqrtA, sqrtB], rounded up. */
export function amountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity) {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const up = (n, d) => (n + d - 1n) / d;
  const a0 = (lo, hi) => up((liquidity << 96n) * (hi - lo), hi) / lo + 1n;
  const a1 = (lo, hi) => up(liquidity * (hi - lo), Q96);
  if (sqrtP <= sqrtA) return [a0(sqrtA, sqrtB), 0n];
  if (sqrtP < sqrtB) return [a0(sqrtP, sqrtB), a1(sqrtA, sqrtP)];
  return [0n, a1(sqrtA, sqrtB)];
}

/** Exact decimal parse of an ETH/USD reference price, e.g. "1996.5" -> { num: 19965n, den: 10n }. */
export function parseUsdPrice(text) {
  if (!/^\d+(\.\d{1,6})?$/.test(String(text))) throw new Error("ETH/USD reference price must be a decimal with at most 6 fractional digits");
  const [whole, frac = ""] = String(text).split(".");
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  if (num === 0n) throw new Error("ETH/USD reference price must be positive");
  return { num, den };
}

export function marketSchedule({ now, releaseAt, opensAt }) {
  const n = BigInt(now);
  const release = BigInt(releaseAt);
  const cutoffAt = release - 300n;
  const deadline = release + 172_800n;
  const opens = opensAt === undefined ? n + 3_600n : BigInt(opensAt);
  if (!(n < opens && opens + 86_400n <= cutoffAt && cutoffAt < release && release < deadline && deadline <= UINT64_MAX)) {
    throw new Error("Release schedule leaves less than 24 hours of trading after opensAt; select a later BEA period");
  }
  return { opensAt: opens, cutoffAt, releaseAt: release, deadline };
}

/**
 * Seed budget per the implementation plan: each ETH timeline pool gets `usdPerTimeline` of USDG and the same value in ETH;
 * the probability pool gets `probabilityUsdg` of USDG on each side. ETH and USDG are split once and shared.
 * Raw units: ETH 18 decimals, USDG 6.
 */
export function seedBudget({ ethUsd, usdPerTimeline = 53n, probabilityUsdg = 67n }) {
  const usdgUnit = 1_000_000n;
  const ethPerTimeline = (usdPerTimeline * 10n ** 18n * ethUsd.den + ethUsd.num - 1n) / ethUsd.num; // round up
  const usdgPerTimeline = usdPerTimeline * usdgUnit;
  const probability = probabilityUsdg * usdgUnit;
  return { ethPerTimeline, usdgPerTimeline, probability, ethSplit: ethPerTimeline, usdgSplit: usdgPerTimeline + probability };
}

export const ETH_POOL_HALF_BAND_TICKS = 2232; // about -20% / +25% price band
export const PROBABILITY_HALF_BAND_TICKS = 6190; // about 35% .. 65% probability
export const TICK_SPACING = 60;

/** Opening position for an ETH timeline pool. `ethClaimIsCurrency0` says which claim sorts first. */
export function ethPoolPlan({ ethClaimIsCurrency0, ethUsd, ethAmount, usdgAmount }) {
  const usdRaw = ethUsd.num * 1_000_000n;
  const ethRaw = 10n ** 18n * ethUsd.den;
  const sqrtP = ethClaimIsCurrency0 ? sqrtPriceX96(usdRaw, ethRaw) : sqrtPriceX96(ethRaw, usdRaw);
  return positionPlan({
    sqrtP, half: ETH_POOL_HALF_BAND_TICKS,
    amount0: ethClaimIsCurrency0 ? ethAmount : usdgAmount, amount1: ethClaimIsCurrency0 ? usdgAmount : ethAmount,
  });
}

export function probabilityPoolPlan({ amount }) {
  return positionPlan({ sqrtP: Q96, half: PROBABILITY_HALF_BAND_TICKS, amount0: amount, amount1: amount });
}

function positionPlan({ sqrtP, half, amount0, amount1 }) {
  const center = tickAtSqrtPrice(sqrtP);
  const tickLower = floorToSpacing(center - half, TICK_SPACING);
  const tickUpper = ceilToSpacing(center + half, TICK_SPACING);
  const sqrtA = sqrtRatioAtTick(tickLower);
  const sqrtB = sqrtRatioAtTick(tickUpper);
  const full = liquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1);
  const liquidity = (full * 9_999n) / 10_000n; // 0.01% headroom so rounding never exceeds the approved amounts
  const [need0, need1] = amountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity);
  return { sqrtPriceX96: sqrtP, tickLower, tickUpper, liquidity, amount0Max: amount0, amount1Max: amount1, amount0Needed: need0, amount1Needed: need1 };
}
