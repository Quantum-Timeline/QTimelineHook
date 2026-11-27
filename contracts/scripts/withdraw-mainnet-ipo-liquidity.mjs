// Takes the treasury's liquidity out of the Anthropic IPO market on Robinhood Chain Mainnet and turns the claims back into collateral.
//   default (no flag)  read-only plan: positions, liquidity, token balances and what the exit would do
//   --broadcast        withdraw all three v4 positions, then merge YES/NO pairs (any time) and redeem the rest (after the result)
// Withdrawing while the market is Open removes the other side of every trade: traders get no quotes. Set QT_IPO_ALLOW_EARLY=1 to confirm that.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWithdrawalPlan } from "./lib/withdraw-liquidity-plan.mjs";
import { MAINNET_CHAIN_ID, MAINNET_CORE, mainnetRpcUrl } from "./lib/mainnet-release-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, getAddress, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || "deployments/robinhood-mainnet-ipo.json");
const broadcast = process.argv.includes("--broadcast");
const ZERO = "0x0000000000000000000000000000000000000000";
const STATUS = ["Draft", "Scheduled", "Open", "AwaitingResult", "FinalYes", "FinalNo", "Cancelled", "Discarded"];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const artifact = (name) => readJson(resolve(root, `contracts/out/${name}.sol/${name}.json`));
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((l) => { const t = l.trim(); const i = t.indexOf("="); return !t || t.startsWith("#") || i < 1 ? [] : [[t.slice(0, i).trim(), t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]]; }));
const erc20Abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }];
const positionManagerAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getPositionLiquidity", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ name: "unlockData", type: "bytes" }, { name: "deadline", type: "uint256" }], outputs: [] },
];

async function main() {
  const manifest = await readJson(manifestPath);
  if (manifest.system !== "anthropic-ipo-pricing" || manifest.chainId !== MAINNET_CHAIN_ID) throw new Error("The manifest is not the Mainnet IPO deployment");
  // QT_EVENT_KEY selects a market created later on the shared engine (manifest.events[key]); without it the original IPO market is used.
  const market = process.env.QT_EVENT_KEY ? manifest.events?.[process.env.QT_EVENT_KEY] : manifest.ipoMarket;
  if (!market?.marketId || !market.positionIds?.length) throw new Error("The manifest has no seeded market for that key");
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const account = privateKeyToAccount(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY);
  if (getAddress(account.address) !== getAddress(manifest.deployer)) throw new Error("The configured key is not the manifest deployer");
  const rpcUrl = mainnetRpcUrl({ override: process.env.QT_MAINNET_RPC, configured: env.RH_MAINNET_RPC });
  const chain = defineChain({ id: MAINNET_CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if (await client.getChainId() !== MAINNET_CHAIN_ID) throw new Error("Wrong chain");

  const [registryArt, factoryArt, vaultArt] = await Promise.all([artifact("IpoMarketRegistry"), artifact("IpoMarketFactory"), artifact("IpoConditionalVault")]);
  const a = manifest.addresses;
  const [info, keys, tokens] = await Promise.all([
    client.readContract({ address: a.IpoMarketRegistry, abi: registryArt.abi, functionName: "market", args: [market.marketId] }),
    client.readContract({ address: a.IpoMarketFactory, abi: factoryArt.abi, functionName: "poolKeys", args: [market.marketId] }),
    client.readContract({ address: a.IpoMarketFactory, abi: factoryArt.abi, functionName: "tokens", args: [market.marketId] }),
  ]);
  const status = Number(info.status);
  const final = status === 4 || status === 5 || status === 6;
  const open = status === 2 || status === 3;

  const positions = [];
  for (let i = 0; i < market.positionIds.length; i += 1) {
    const tokenId = BigInt(market.positionIds[i]);
    const [owner, liquidity] = await Promise.all([
      client.readContract({ address: MAINNET_CORE.PositionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] }),
      client.readContract({ address: MAINNET_CORE.PositionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
    ]);
    if (getAddress(owner) !== getAddress(account.address)) throw new Error(`Position ${tokenId} is not owned by the deployer`);
    if (liquidity > 0n) positions.push({ tokenId, liquidity, key: keys[i] });
  }
  const balances = await Promise.all(tokens.map((token) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  console.log(JSON.stringify({
    marketId: market.marketId, status: STATUS[status], positionsWithLiquidity: positions.map((p) => ({ tokenId: p.tokenId.toString(), liquidity: p.liquidity.toString() })),
    claimBalances: { ethYes: balances[0].toString(), ethNo: balances[1].toString(), usdgYes: balances[2].toString(), usdgNo: balances[3].toString() },
    broadcast,
  }, null, 2));
  if (!broadcast) { console.log("Plan only. Add --broadcast to withdraw."); return; }
  if (open && process.env.QT_IPO_ALLOW_EARLY !== "1") throw new Error("The market is still trading. Withdrawing now removes all quotes for traders; set QT_IPO_ALLOW_EARLY=1 to do it anyway.");
  if (status < 2 && !final) throw new Error(`Market status ${STATUS[status]} has nothing to withdraw yet`);

  const send = async (label, request) => {
    await client.simulateContract({ account, ...request });
    const hash = await wallet.writeContract({ account, ...request });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label}: ${hash}`);
    return hash;
  };

  const result = { status: STATUS[status], transactions: {}, completedAt: undefined };
  if (positions.length) {
    const plan = buildWithdrawalPlan(positions, account.address);
    const params = plan.params.map((p) => p.type === "decrease"
      ? encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [p.tokenId, p.liquidity, 0n, 0n, "0x"])
      : encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [p.key.currency0, p.key.currency1, account.address]));
    const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [plan.actions, params]);
    result.transactions.withdraw = await send("PositionManager.modifyLiquidities", { address: MAINNET_CORE.PositionManager, abi: positionManagerAbi, functionName: "modifyLiquidities", args: [unlockData, (await client.getBlock()).timestamp + 300n] });
  }

  // Claims now sit in the deployer wallet. Before a result, pairs merge back to collateral; after a result the vault only redeems.
  const vault = getAddress(info.vault);
  for (const [asset, yesIdx, noIdx] of [[ZERO, 0, 1], [MAINNET_CORE.USDG, 2, 3]]) {
    const [yes, no] = await Promise.all([tokens[yesIdx], tokens[noIdx]].map((token) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
    const pair = yes < no ? yes : no;
    if (!final && pair > 0n) result.transactions[`merge_${asset === ZERO ? "eth" : "usdg"}`] = await send(`Vault.merge ${asset === ZERO ? "ETH" : "USDG"}`, { address: vault, abi: vaultArt.abi, functionName: "merge", args: [asset, pair, account.address] });
    if (final) {
      for (const [side, token] of [[true, tokens[yesIdx]], [false, tokens[noIdx]]]) {
        const left = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
        if (left > 0n) result.transactions[`redeem_${asset === ZERO ? "eth" : "usdg"}_${side ? "yes" : "no"}`] = await send(`Vault.redeem ${asset === ZERO ? "ETH" : "USDG"} ${side ? "YES" : "NO"}`, { address: vault, abi: vaultArt.abi, functionName: "redeem", args: [asset, side, left, account.address] });
      }
    }
  }
  const after = await Promise.all(tokens.map((token) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  result.remainingClaims = after.map(String);
  result.completedAt = new Date().toISOString();
  market.liquidityWithdrawal = result;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (!final && after.some((x) => x > 0n)) console.log("Unpaired claims remain. Run this again after the market resolves or is cancelled to redeem them.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
