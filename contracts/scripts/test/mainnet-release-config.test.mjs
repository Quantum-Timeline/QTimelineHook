import test from "node:test";
import assert from "node:assert/strict";
import { MAINNET_CHAIN_ID, MAINNET_CORE, requireMainnetBroadcast, validateMainnetSigners } from "../lib/mainnet-release-config.mjs";

test("release config pins Robinhood mainnet core addresses and chain id", () => {
  assert.equal(MAINNET_CHAIN_ID, 4663);
  assert.equal(MAINNET_CORE.PoolManager.toLowerCase(), "0x8366a39cc670b4001a1121b8f6a443a643e40951");
  assert.equal(MAINNET_CORE.USDG.toLowerCase(), "0x5fc5360d0400a0fd4f2af552add042d716f1d168");
});

test("signer validation rejects a wrong chain and shared deployer/resolver wallet", () => {
  const deployer = "0x0000000000000000000000000000000000000001";
  assert.throws(() => validateMainnetSigners({ chainId: 46630, deployer, resolver: "0x0000000000000000000000000000000000000002" }), /chain ID 4663/);
  assert.throws(() => validateMainnetSigners({ chainId: 4663, deployer, resolver: deployer }), /distinct/);
  assert.doesNotThrow(() => validateMainnetSigners({ chainId: 4663, deployer, resolver: "0x0000000000000000000000000000000000000002" }));
});

test("mainnet deployment refuses to broadcast without an explicit flag", () => {
  assert.equal(requireMainnetBroadcast(["node", "deploy-mainnet.mjs", "--preflight"]), false);
  assert.throws(() => requireMainnetBroadcast(["node", "deploy-mainnet.mjs"]), /--broadcast/);
  assert.equal(requireMainnetBroadcast(["node", "deploy-mainnet.mjs", "--broadcast"]), true);
});

test('testnet market schedule supports an exact BEA release timestamp without changing factory windows', async () => {
  let scheduleModule;
  try { scheduleModule = await import('../lib/testnet-market-schedule.mjs'); } catch { scheduleModule = {}; }
  assert.equal(typeof scheduleModule.testnetMarketSchedule, 'function');
  const planned = scheduleModule.testnetMarketSchedule({ now: 1_795_000_000n, shortTestnet: false, releaseAtOverride: '1795613400' });
  assert.deepEqual(planned, { opensAt: 1_795_003_600n, cutoffAt: 1_795_613_100n, releaseAt: 1_795_613_400n, deadline: 1_795_786_200n });
  assert.throws(() => scheduleModule.testnetMarketSchedule({ now: 1_795_000_000n, shortTestnet: false, releaseAtOverride: '1795004000' }), /market schedule window/);
});
