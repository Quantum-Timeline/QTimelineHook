import test from "node:test";
import assert from "node:assert/strict";
import { buildWithdrawalPlan } from "../lib/withdraw-liquidity-plan.mjs";

test("builds one full position decrease and pair take per LP pool", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const keys = [
    { currency0: "0x0000000000000000000000000000000000000000", currency1: "0x2222222222222222222222222222222222222222" },
    { currency0: "0x3333333333333333333333333333333333333333", currency1: "0x4444444444444444444444444444444444444444" },
  ];
  const plan = buildWithdrawalPlan([
    { tokenId: 10n, liquidity: 1000n, key: keys[0] },
    { tokenId: 11n, liquidity: 2000n, key: keys[1] },
  ], owner);

  assert.equal(plan.actions, "0x01110111");
  assert.equal(plan.params.length, 4);
  assert.equal(plan.positions, 2);
  assert.equal(plan.takeRecipients[0], owner);
});

test("rejects zero liquidity and empty plans before they reach PositionManager", () => {
  const key = { currency0: "0x0000000000000000000000000000000000000000", currency1: "0x2222222222222222222222222222222222222222" };
  assert.throws(() => buildWithdrawalPlan([], "0x1111111111111111111111111111111111111111"), /at least one/);
  assert.throws(() => buildWithdrawalPlan([{ tokenId: 1n, liquidity: 0n, key }], "0x1111111111111111111111111111111111111111"), /positive liquidity/);
});
