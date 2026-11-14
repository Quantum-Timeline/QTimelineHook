import test from "node:test";
import assert from "node:assert/strict";
import { findBestProbabilitySell } from "./probability-sell.mjs";

test("finds the equal split for a 1:1 probability pool", async () => {
  const result = await findBestProbabilitySell(100n, async (amount) => amount);
  assert.equal(result.swapAmount, 50n);
  assert.equal(result.swapOut, 50n);
  assert.equal(result.collateralOut, 50n);
});

test("checks both sides of the crossing and selects the highest merge payout", async () => {
  const result = await findBestProbabilitySell(100n, async (amount) => amount * 2n);
  assert.equal(result.swapAmount, 33n);
  assert.equal(result.swapOut, 66n);
  assert.equal(result.collateralOut, 66n);
});

test("uses the largest fully quotable input when pool depth is limited", async () => {
  const result = await findBestProbabilitySell(100n, async (amount) => amount <= 20n ? amount : undefined);
  assert.equal(result.swapAmount, 20n);
  assert.equal(result.swapOut, 20n);
  assert.equal(result.collateralOut, 20n);
});

test("skips amounts whose rounded swap output is zero", async () => {
  const result = await findBestProbabilitySell(100n, async (amount) => amount >= 10n ? amount : 0n);
  assert.equal(result.swapAmount, 50n);
  assert.equal(result.swapOut, 50n);
  assert.equal(result.collateralOut, 50n);
});

test("rejects an input with no valid swap amount", async () => {
  await assert.rejects(() => findBestProbabilitySell(100n, async () => undefined), /no fully quotable/);
});
