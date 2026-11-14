import test from "node:test";
import assert from "node:assert/strict";
import { canTradeAt } from "./market-lifecycle.ts";

const opensAt = 1000n;
const cutoffAt = 2000n;

test("scheduled market becomes tradeable only inside its on-chain time window", () => {
  assert.equal(canTradeAt({ status: 1, activated: true, opensAt, cutoffAt, chainTimestamp: 999n }), false);
  assert.equal(canTradeAt({ status: 1, activated: true, opensAt, cutoffAt, chainTimestamp: 1000n }), true);
  assert.equal(canTradeAt({ status: 1, activated: true, opensAt, cutoffAt, chainTimestamp: 1999n }), true);
  assert.equal(canTradeAt({ status: 1, activated: true, opensAt, cutoffAt, chainTimestamp: 2000n }), false);
  assert.equal(canTradeAt({ status: 2, activated: false, opensAt, cutoffAt, chainTimestamp: 1500n }), false);
  assert.equal(canTradeAt({ status: 4, activated: true, opensAt, cutoffAt, chainTimestamp: 1500n }), false);
});
