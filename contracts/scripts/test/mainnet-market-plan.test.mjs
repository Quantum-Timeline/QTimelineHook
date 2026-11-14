import assert from "node:assert/strict";
import test from "node:test";
import {
  Q96, sqrtRatioAtTick, sqrtPriceX96, tickAtSqrtPrice, parseUsdPrice, marketSchedule, seedBudget, ethPoolPlan, probabilityPoolPlan,
} from "../lib/mainnet-market-plan.mjs";

// Reference values printed by Uniswap v4-core TickMath.getSqrtPriceAtTick under Foundry.
const VECTORS = [
  [-6240, 57994456122062326708348696866n], [6240, 108236237653045900831404089519n], [2220, 88528653970236618908555890988n],
  [-2280, 70692361251746556480505932001n], [0, 79228162514264337593543950336n], [1, 79232123823359799118286999568n],
  [-1, 79224201403219477170569942574n], [60000, 1591101516320542774261326897414n], [-887220, 4306310044n],
];

test("tick math matches v4-core TickMath vectors", () => {
  for (const [tick, expected] of VECTORS) assert.equal(sqrtRatioAtTick(tick), expected, `tick ${tick}`);
});

test("tickAtSqrtPrice returns the containing tick", () => {
  for (const tick of [-6240, -1, 0, 1, 2220, 60000]) {
    assert.equal(tickAtSqrtPrice(sqrtRatioAtTick(tick)), tick);
    assert.equal(tickAtSqrtPrice(sqrtRatioAtTick(tick) + 1n), tick);
  }
});

test("opening plan reproduces the Foundry fork liquidity at ETH 2000 and the plan seed budget", () => {
  const ethUsd = parseUsdPrice("2000");
  const eth = 26_500_000_000_000_000n;
  const usdg = 53_000_000n;
  const liquidities = [true, false].map((ethIs0) => ethPoolPlan({ ethClaimIsCurrency0: ethIs0, ethUsd, ethAmount: eth, usdgAmount: usdg }).liquidity);
  // The fork test seeds liquidity 11132940485879 (before the planner's 0.01% headroom) for whichever orientation sorted on mainnet.
  assert.ok(liquidities.some((l) => l >= 11_131_000_000_000n && l <= 11_132_940_485_879n), `got ${liquidities}`);
  const prob = probabilityPoolPlan({ amount: 67_000_000n });
  assert.ok(prob.liquidity <= 249_993_420n && prob.liquidity > 249_900_000n, `got ${prob.liquidity}`);
  assert.equal(prob.tickLower, -6240);
  assert.equal(prob.tickUpper, 6240);
  assert.ok(prob.amount0Needed <= 67_000_000n && prob.amount1Needed <= 67_000_000n);
});

test("planned positions never need more than the approved amounts", () => {
  for (const price of ["1500", "1996.5", "3200.25"]) {
    const ethUsd = parseUsdPrice(price);
    const b = seedBudget({ ethUsd });
    for (const ethIs0 of [true, false]) {
      const plan = ethPoolPlan({ ethClaimIsCurrency0: ethIs0, ethUsd, ethAmount: b.ethPerTimeline, usdgAmount: b.usdgPerTimeline });
      assert.ok(plan.amount0Needed <= plan.amount0Max && plan.amount1Needed <= plan.amount1Max, `${price} ${ethIs0}`);
      assert.ok(plan.tickLower % 60 === 0);
      assert.ok(plan.tickUpper % 60 === 0);
      assert.ok(plan.sqrtPriceX96 > sqrtRatioAtTick(plan.tickLower) && plan.sqrtPriceX96 < sqrtRatioAtTick(plan.tickUpper));
    }
  }
});

test("seed budget matches the implementation plan at ETH 1996", () => {
  const b = seedBudget({ ethUsd: parseUsdPrice("1996") });
  assert.equal(b.usdgSplit, 120_000_000n);
  assert.ok(b.ethSplit > 26_500_000_000_000_000n && b.ethSplit < 26_600_000_000_000_000n, `${b.ethSplit}`);
});

test("sqrtPriceX96 of an equal pair is exactly Q96", () => {
  assert.equal(sqrtPriceX96(5n, 5n), Q96);
});

test("schedule enforces cutoff/release/deadline and 24h of trading", () => {
  const release = 1_795_613_400n;
  const s = marketSchedule({ now: 1_794_000_000, releaseAt: release });
  assert.equal(s.cutoffAt, release - 300n);
  assert.equal(s.deadline, release + 172_800n);
  assert.throws(() => marketSchedule({ now: Number(release) - 3_600, releaseAt: release }), /less than 24 hours/);
  assert.throws(() => marketSchedule({ now: Number(release) - 80_000, releaseAt: release, opensAt: Number(release) - 70_000 }), /less than 24 hours/);
});

test("price parser is exact and strict", () => {
  assert.deepEqual(parseUsdPrice("1996.5"), { num: 19965n, den: 10n });
  assert.throws(() => parseUsdPrice("-1"));
  assert.throws(() => parseUsdPrice("1e3"));
  assert.throws(() => parseUsdPrice("0"));
});
