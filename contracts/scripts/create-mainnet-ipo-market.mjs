// Creates, seeds and activates the Anthropic IPO pricing market on Robinhood Chain Mainnet (4663).
// A separate system from Core PCE: it reads QTIMELINE_IPO_MANIFEST and the Ipo* contracts, and never touches the PCE manifest.
//   --plan       read-only: prints schedule, seed budget, ticks and liquidity. Sends nothing.
//   --broadcast  resumable: createMarket -> initializePools -> split -> approvals -> three LP mints -> activateMarket.
//   --quote      read-only: quotes a $5 swap in every direction once the market is Open and prints price impact.
// Required env: QT_IPO_CUTOFF_AT (unix seconds, last moment of trading, before the offering is priced),
//               QT_IPO_THRESHOLD (dollars, YES if the final offer price is at or above it), QT_ETH_USD (reference price).
// Optional env: QT_IPO_PERIOD (default ANT-IPO-PRICE-2026-11), QT_IPO_OPENS_AT, QT_MAINNET_RPC (override, e.g. an Anvil fork).
import { createPrivateKey, sign as signMldsa } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { MAINNET_CHAIN_ID, MAINNET_CORE, mainnetRpcUrl } from "./lib/mainnet-release-config.mjs";
import { ethPoolPlan, parseUsdPrice, probabilityPoolPlan, seedBudget } from "./lib/mainnet-market-plan.mjs";
import { ipoSchedule, parsePriceCents } from "./lib/ipo-market-plan.mjs";

const root = process.cwd();
const require = createRequire(resolve(root, "apps/web/package.json"));
const { concatHex, createPublicClient, createWalletClient, defineChain, encodeAbiParameters, formatEther, getAddress, getCreate2Address, hashTypedData, http, keccak256, stringToHex, toHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const flags = new Set(process.argv.slice(2));
const mode = flags.has("--broadcast") ? "broadcast" : flags.has("--quote") ? "quote" : flags.has("--plan") ? "plan" : null;
if (!mode) throw new Error("Pass exactly one of --plan, --broadcast or --quote");
const secretDir = resolve(root, "contracts/.secrets");
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || "deployments/robinhood-mainnet-ipo.json");
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ZERO = "0x0000000000000000000000000000000000000000";
const FIVE_USD = 5_000_000n;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];
const permit2Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "address" }], outputs: [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint160" }, { type: "uint48" }], outputs: [] },
];
const positionManagerAbi = [
  { type: "function", name: "getPositionLiquidity", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ type: "bytes" }, { type: "uint256" }], outputs: [] },
];
const poolKeyComponents = [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
];
const quoterAbi = [{
  type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ type: "tuple", name: "params", components: [
    { name: "poolKey", type: "tuple", components: poolKeyComponents }, { name: "zeroForOne", type: "bool" },
    { name: "exactAmount", type: "uint128" }, { name: "hookData", type: "bytes" },
  ] }],
  outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }],
}];
const createMarketTypes = { CreateMarket: [{ name: "configHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "signatureExpiry", type: "uint64" }] };

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const t = line.trim();
    const at = t.indexOf("=");
    return !t || t.startsWith("#") || at < 1 ? [] : [[t.slice(0, at).trim(), t.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}
const artifact = async (name) => JSON.parse(await readFile(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"));
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function main() {
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const rpcUrl = mainnetRpcUrl({ override: process.env.QT_MAINNET_RPC, configured: env.RH_MAINNET_RPC });
  const chain = defineChain({ id: MAINNET_CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  if (await client.getChainId() !== MAINNET_CHAIN_ID) throw new Error(`RPC is not chain ${MAINNET_CHAIN_ID}`);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.chainId !== MAINNET_CHAIN_ID || !manifest.deployedAndSealed || manifest.system !== "anthropic-ipo-pricing") throw new Error("The IPO manifest must record a sealed Anthropic IPO deployment on chain 4663");
  const a = manifest.addresses;
  const deployerKeyHex = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
  const account = privateKeyToAccount(deployerKeyHex);
  if (getAddress(account.address) !== getAddress(manifest.deployer)) throw new Error("Configured deployer key does not match the manifest deployer");
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const factoryArt = await artifact("IpoMarketFactory");
  const registryArt = await artifact("IpoMarketRegistry");
  const hookDeployerArt = await artifact("IpoHookDeployer");
  const verifierArt = await artifact("MLDSA44Verifier");
  const vaultArt = await artifact("IpoConditionalVault");
  const factory = a.IpoMarketFactory;

  if (mode === "quote") return quote({ client, manifest, factoryArt, registryArt, factory });

  const period = process.env.QT_IPO_PERIOD ?? "ANT-IPO-PRICE-2026-11";
  const cutoffText = process.env.QT_IPO_CUTOFF_AT;
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(period)) throw new Error("QT_IPO_PERIOD must be 3-64 letters, digits, dots, dashes or underscores");
  if (!cutoffText || !/^\d+$/.test(cutoffText)) throw new Error("Set QT_IPO_CUTOFF_AT to the last moment of trading in unix seconds (before the offering is priced)");
  const thresholdCents = parsePriceCents(process.env.QT_IPO_THRESHOLD ?? "");
  const ethUsd = parseUsdPrice(process.env.QT_ETH_USD ?? "");
  const block = await client.getBlock();
  const existing = manifest.ipoMarket;
  const sched = manifest.schedule;
  if (!sched) throw new Error("The IPO manifest has no recorded schedule parameters");
  const schedule = existing
    ? { opensAt: BigInt(existing.opensAt), cutoffAt: BigInt(existing.cutoffAt), releaseAt: BigInt(existing.releaseAt), deadline: BigInt(existing.deadline) }
    : ipoSchedule({
      now: block.timestamp, cutoffAt: cutoffText, releaseDelay: sched.releaseDelaySeconds, resolutionWindow: sched.resolutionWindowSeconds,
      minimumTradingWindow: sched.minimumTradingWindowSeconds, opensAt: process.env.QT_IPO_OPENS_AT,
    });
  if (existing && (existing.period !== period || BigInt(existing.cutoffAt) !== BigInt(cutoffText) || existing.thresholdCents !== thresholdCents)) {
    throw new Error("Manifest market does not match QT_IPO_PERIOD / QT_IPO_CUTOFF_AT / QT_IPO_THRESHOLD");
  }
  // Seed size in whole USD per side: each ETH timeline pool (default 53) and the probability pool (default 67). Smaller seeds cost less capital but raise price impact.
  const wholeUsd = (name, fallback) => {
    const text = process.env[name];
    if (text === undefined || text === "") return fallback;
    if (!/^[1-9]\d{0,3}$/.test(text)) throw new Error(`${name} must be a whole number of USD between 1 and 9999`);
    return BigInt(text);
  };
  const budget = seedBudget({ ethUsd, usdPerTimeline: wholeUsd("QT_IPO_SEED_TIMELINE_USD", 53n), probabilityUsdg: wholeUsd("QT_IPO_SEED_PROBABILITY_USD", 67n) });
  const periodId = keccak256(stringToHex(period));

  const ethBalance = await client.getBalance({ address: account.address });
  const usdgBalance = await client.readContract({ address: MAINNET_CORE.USDG, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const summary = {
    mode, period, periodId, thresholdCents, thresholdDollars: (thresholdCents / 100).toFixed(2), cutoffAtUtc: new Date(Number(schedule.cutoffAt) * 1000).toISOString(), releaseAtUtc: new Date(Number(schedule.releaseAt) * 1000).toISOString(),
    opensAt: schedule.opensAt, cutoffAt: schedule.cutoffAt, releaseAt: schedule.releaseAt, deadline: schedule.deadline,
    referenceEthUsd: process.env.QT_ETH_USD,
    budget: { ethSplit: formatEther(budget.ethSplit), usdgSplit: (Number(budget.usdgSplit) / 1e6).toString() },
    deployer: account.address, deployerEth: formatEther(ethBalance), deployerUsdg: (Number(usdgBalance) / 1e6).toString(),
  };
  const shortfalls = [];
  // Gas on this chain is about 0.02 gwei, so the whole flow costs well under 0.0005 ETH. Headroom defaults to 0.001 ETH (override with QT_IPO_GAS_HEADROOM_WEI).
  const gasHeadroom = BigInt(process.env.QT_IPO_GAS_HEADROOM_WEI ?? 1_000_000_000_000_000n);
  const needEth = existing?.seeded ? 0n : budget.ethSplit + gasHeadroom;
  const needUsdg = existing?.seeded ? 0n : budget.usdgSplit;
  if (ethBalance < needEth) shortfalls.push(`ETH: need ${formatEther(needEth)} (seed + gas headroom), have ${formatEther(ethBalance)}`);
  if (usdgBalance < needUsdg) shortfalls.push(`USDG: need ${Number(needUsdg) / 1e6}, have ${Number(usdgBalance) / 1e6}`);
  summary.shortfalls = shortfalls;

  // Resolve the frozen PoolKeys either from the chain (market exists) or by predicting orientation after creation.
  if (mode === "plan" && !existing) {
    console.log(json({ ...summary, note: "Plan only. Token orientation, ticks and liquidity are computed from the real PoolKeys after createMarket; the plan mode prints the schedule and funding need." }));
    return;
  }
  if (mode === "plan") {
    const view = await readMarketState({ client, factoryArt, registryArt, factory, registry: a.IpoMarketRegistry, marketId: existing.marketId });
    console.log(json({ ...summary, positions: buildPositions({ view, ethUsd, budget }).map(describePosition), state: existing }));
    return;
  }
  if (shortfalls.length) throw new Error(`Deployer is not funded for the seed: ${shortfalls.join("; ")}`);

  const state = manifest.ipoMarket ?? {};
  const save = async () => { manifest.ipoMarket = state; await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); };
  const send = async (label, request) => {
    const { request: prepared } = await client.simulateContract({ account, ...request });
    const hash = await wallet.writeContract(prepared);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label}: ${hash} (${receipt.gasUsed} gas)`);
    return { hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber.toString(), receipt };
  };

  // 1. createMarket (ECDSA + ML-DSA-44 signed by the deployer)
  if (!state.marketId) {
    const nonce = await client.readContract({ address: factory, abi: factoryArt.abi, functionName: "nonces", args: [account.address] });
    const signatureExpiry = block.timestamp + 1_800n;
    if (signatureExpiry > schedule.opensAt) throw new Error("opensAt must be at least 30 minutes away so the creation signature stays valid until opening");
    const config = {
      opensAt: schedule.opensAt, cutoffAt: schedule.cutoffAt, releaseAt: schedule.releaseAt, deadline: schedule.deadline, periodId, thresholdBps: thresholdCents,
      ethCollateralCap: 100_000_000_000_000_000n, usdgCollateralCap: 500_000_000n, nonce, signatureExpiry,
    };
    const configHash = keccak256(encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }, { type: "int32" }, { type: "uint256" }, { type: "uint256" }],
      [BigInt(MAINNET_CHAIN_ID), factory, config.opensAt, config.cutoffAt, config.releaseAt, config.deadline, periodId, thresholdCents, config.ethCollateralCap, config.usdgCollateralCap],
    ));
    const marketId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [configHash, nonce]));
    const domain = { name: "QTimeline", version: "1", chainId: MAINNET_CHAIN_ID, verifyingContract: factory };
    const message = { configHash, nonce, signatureExpiry };
    const digest = hashTypedData({ domain, types: createMarketTypes, primaryType: "CreateMarket", message });
    const seedFile = await readFile(resolve(secretDir, "mainnet-deployer-mldsa44.seed"));
    const seed = seedFile.length === 32 ? seedFile : Buffer.from(seedFile.toString("utf8").trim().replace(/^0x/i, ""), "hex");
    if (seed.length !== 32) throw new Error("Deployer ML-DSA-44 seed must be 32 bytes");
    const pqKey = createPrivateKey({ key: seed, format: "raw-seed", asymmetricKeyType: "ml-dsa-44" });
    const pqSignature = `0x${signMldsa(null, Buffer.from(digest.slice(2), "hex"), pqKey).toString("hex")}`;
    const blob = manifest.deployments?.deployerPKBlob?.address;
    if (!blob) throw new Error("Manifest is missing the deployer public-key blob");
    const accepted = await client.readContract({ address: a.MLDSA44Verifier, abi: verifierArt.abi, functionName: "verify", args: [blob, digest, pqSignature] });
    if (!accepted) throw new Error("Deployed verifier rejected the market-creation ML-DSA signature");
    const ecdsaSignature = await account.signTypedData({ domain, types: createMarketTypes, primaryType: "CreateMarket", message });
    const ich = await client.readContract({ address: a.IpoHookDeployer, abi: hookDeployerArt.abi, functionName: "proxyInitCodeHash", args: [a.IpoMarketRegistry, marketId] });
    let salt; let hook;
    for (let i = 0n; i < 5_000_000n; i += 1n) {
      const candidate = toHex(i, { size: 32 });
      const predicted = getCreate2Address({ from: a.IpoHookDeployer, salt: candidate, bytecodeHash: ich });
      if ((BigInt(predicted) & 0x3fffn) === 0x2880n) { salt = candidate; hook = predicted; break; }
    }
    if (!salt) throw new Error("No CREATE2 salt found for the hook permission bits");
    const created = await send("IpoMarketFactory.createMarket", { address: factory, abi: factoryArt.abi, functionName: "createMarket", args: [config, ecdsaSignature, pqSignature, salt] });
    Object.assign(state, {
      marketId, configHash, period, periodId, thresholdCents, thresholdBps: thresholdCents, opensAt: schedule.opensAt.toString(), cutoffAt: schedule.cutoffAt.toString(),
      releaseAt: schedule.releaseAt.toString(), deadline: schedule.deadline.toString(), hook, referenceEthUsd: process.env.QT_ETH_USD,
      transactions: { create: { hash: created.hash, gasUsed: created.gasUsed, blockNumber: created.blockNumber } },
    });
    await save();
  }

  const view = await readMarketState({ client, factoryArt, registryArt, factory, registry: a.IpoMarketRegistry, marketId: state.marketId });
  const positions = buildPositions({ view, ethUsd, budget });
  state.vault = view.vault;
  state.tokens = view.tokens;
  state.poolIds = view.poolIds;
  state.transactions ??= {};

  // 2. initialize the three pools at the reference prices
  if (!(await client.readContract({ address: factory, abi: factoryArt.abi, functionName: "poolsInitialized", args: [state.marketId] }))) {
    const r = await send("IpoMarketFactory.initializePools", { address: factory, abi: factoryArt.abi, functionName: "initializePools", args: [state.marketId, positions.map((p) => p.sqrtPriceX96)] });
    state.transactions.initializePools = { hash: r.hash, gasUsed: r.gasUsed };
    await save();
  }

  // 3. split collateral once (ETH, then USDG)
  const vaultAbi = vaultArt.abi;
  const outcomeBalances = await Promise.all(view.tokens.map((t) => client.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  if (outcomeBalances[0] < budget.ethSplit) {
    const r = await send("ConditionalVault.split(ETH)", { address: view.vault, abi: vaultAbi, functionName: "split", args: [ZERO, budget.ethSplit, account.address], value: budget.ethSplit });
    state.transactions.splitEth = { hash: r.hash, gasUsed: r.gasUsed };
    await save();
  }
  if (outcomeBalances[2] < budget.usdgSplit) {
    const allowance = await client.readContract({ address: MAINNET_CORE.USDG, abi: erc20Abi, functionName: "allowance", args: [account.address, view.vault] });
    if (allowance < budget.usdgSplit) await send("USDG.approve(vault)", { address: MAINNET_CORE.USDG, abi: erc20Abi, functionName: "approve", args: [view.vault, budget.usdgSplit] });
    const r = await send("ConditionalVault.split(USDG)", { address: view.vault, abi: vaultAbi, functionName: "split", args: [MAINNET_CORE.USDG, budget.usdgSplit, account.address] });
    state.transactions.splitUsdg = { hash: r.hash, gasUsed: r.gasUsed };
    await save();
  }

  // 4. Permit2 approvals for every claim token that LP positions pull
  const need = new Map();
  for (const p of positions) {
    need.set(p.key.currency0, (need.get(p.key.currency0) ?? 0n) + p.amount0Max);
    need.set(p.key.currency1, (need.get(p.key.currency1) ?? 0n) + p.amount1Max);
  }
  const expiration = BigInt(Number(block.timestamp) + 7 * 86_400);
  for (const [token, amount] of need) {
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, permit2] });
    if (allowance < amount) await send(`approve(Permit2) ${token}`, { address: token, abi: erc20Abi, functionName: "approve", args: [permit2, amount] });
    const [p2amount, p2expiry] = await client.readContract({ address: permit2, abi: permit2Abi, functionName: "allowance", args: [account.address, token, MAINNET_CORE.PositionManager] });
    if (p2amount < amount || BigInt(p2expiry) < expiration - 86_400n) await send(`Permit2.approve ${token}`, { address: permit2, abi: permit2Abi, functionName: "approve", args: [token, MAINNET_CORE.PositionManager, amount, Number(expiration)] });
  }

  // 5. mint the three treasury positions
  state.positionIds ??= [];
  state.transactions.positions ??= [];
  for (let i = 0; i < positions.length; i += 1) {
    if (state.positionIds[i]) continue;
    const p = positions[i];
    const params = [
      encodeAbiParameters([
        { type: "tuple", components: poolKeyComponents }, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" },
      ], [p.key, p.tickLower, p.tickUpper, p.liquidity, p.amount0Max, p.amount1Max, account.address, "0x"]),
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [p.key.currency0, p.key.currency1]),
    ];
    const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x020d", params]);
    const deadlineTs = (await client.getBlock()).timestamp + 600n;
    const r = await send(`PositionManager.mint pool ${i}`, { address: MAINNET_CORE.PositionManager, abi: positionManagerAbi, functionName: "modifyLiquidities", args: [unlockData, deadlineTs] });
    const transferTopic = keccak256(stringToHex("Transfer(address,address,uint256)"));
    const ownerTopic = `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`;
    const log = r.receipt.logs.find((l) => l.address.toLowerCase() === MAINNET_CORE.PositionManager.toLowerCase() && l.topics[0] === transferTopic && l.topics[2] === ownerTopic);
    if (!log?.topics[3]) throw new Error(`Could not recover the position NFT for pool ${i}`);
    state.positionIds[i] = BigInt(log.topics[3]).toString();
    state.transactions.positions[i] = { hash: r.hash, gasUsed: r.gasUsed };
    await save();
  }
  const liquidityRead = await Promise.all(state.positionIds.map((id) => client.readContract({ address: MAINNET_CORE.PositionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [BigInt(id)] })));
  liquidityRead.forEach((l, i) => { if (l !== positions[i].liquidity) throw new Error(`Position ${i} liquidity ${l} does not match plan ${positions[i].liquidity}`); });
  state.seeded = true;
  state.positions = positions.map(describePosition);
  await save();

  // 6. activate (needs all three pools liquid and 24h of trading before cutoff)
  const market = await client.readContract({ address: a.IpoMarketRegistry, abi: registryArt.abi, functionName: "market", args: [state.marketId] });
  if (!market.activated) {
    const r = await send("IpoMarketFactory.activateMarket", { address: factory, abi: factoryArt.abi, functionName: "activateMarket", args: [state.marketId] });
    state.transactions.activate = { hash: r.hash, gasUsed: r.gasUsed };
  }
  const finalMarket = await client.readContract({ address: a.IpoMarketRegistry, abi: registryArt.abi, functionName: "market", args: [state.marketId] });
  if (!finalMarket.activated) throw new Error("Market is not activated after the activation transaction");
  state.activated = true;
  state.status = ["Draft", "Scheduled", "Open", "AwaitingResult", "FinalYes", "FinalNo", "Cancelled", "Discarded"][Number(finalMarket.status)];
  await save();
  console.log(json({ ...summary, marketId: state.marketId, hook: state.hook, vault: state.vault, status: state.status, positionIds: state.positionIds }));
}

async function readMarketState({ client, factoryArt, registryArt, factory, registry, marketId }) {
  const [tokens, keys, vault] = await Promise.all([
    client.readContract({ address: factory, abi: factoryArt.abi, functionName: "tokens", args: [marketId] }),
    client.readContract({ address: factory, abi: factoryArt.abi, functionName: "poolKeys", args: [marketId] }),
    client.readContract({ address: factory, abi: factoryArt.abi, functionName: "vaultOf", args: [marketId] }),
  ]);
  const poolIds = keys.map((k) => keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks])));
  for (const id of poolIds) {
    if (!(await client.readContract({ address: registry, abi: registryArt.abi, functionName: "isRegisteredPool", args: [marketId, id] }))) throw new Error("Computed pool ID is not registered for the market");
  }
  return { tokens: tokens.map((t) => getAddress(t)), keys: keys.map((k) => ({ currency0: getAddress(k.currency0), currency1: getAddress(k.currency1), fee: k.fee, tickSpacing: k.tickSpacing, hooks: getAddress(k.hooks) })), vault: getAddress(vault), poolIds };
}

function buildPositions({ view, ethUsd, budget }) {
  const [yesEth, noEth] = view.tokens;
  const ethPool = (i, claim) => {
    const key = view.keys[i];
    const plan = ethPoolPlan({ ethClaimIsCurrency0: key.currency0.toLowerCase() === claim.toLowerCase(), ethUsd, ethAmount: budget.ethPerTimeline, usdgAmount: budget.usdgPerTimeline });
    return { key, ...plan };
  };
  const prob = probabilityPoolPlan({ amount: budget.probability });
  return [ethPool(0, yesEth), ethPool(1, noEth), { key: view.keys[2], ...prob }];
}

function describePosition(p) {
  return {
    currency0: p.key.currency0, currency1: p.key.currency1, tickLower: p.tickLower, tickUpper: p.tickUpper,
    liquidity: p.liquidity.toString(), sqrtPriceX96: p.sqrtPriceX96.toString(), amount0Max: p.amount0Max.toString(), amount1Max: p.amount1Max.toString(),
    amount0Needed: p.amount0Needed.toString(), amount1Needed: p.amount1Needed.toString(),
  };
}

async function quote({ client, manifest, factoryArt, registryArt, factory }) {
  const state = manifest.ipoMarket;
  if (!state?.marketId) throw new Error("No Mainnet market in the manifest");
  const a = manifest.addresses;
  const market = await client.readContract({ address: a.IpoMarketRegistry, abi: registryArt.abi, functionName: "market", args: [state.marketId] });
  const now = (await client.getBlock()).timestamp;
  if (Number(market.status) !== 2 && !(market.activated && now >= market.opensAt && now < market.cutoffAt)) {
    throw new Error(`Quotes need an Open market (status ${market.status}); the hook rejects swaps until opensAt`);
  }
  const keys = await client.readContract({ address: factory, abi: factoryArt.abi, functionName: "poolKeys", args: [state.marketId] });
  const tokens = (await client.readContract({ address: factory, abi: factoryArt.abi, functionName: "tokens", args: [state.marketId] })).map((t) => t.toLowerCase());
  const [yesEth, noEth, yesUsd, noUsd] = tokens;
  const ref = parseUsdPrice(state.referenceEthUsd);
  const rows = [];
  const quoteOne = async (poolIndex, tokenIn, amount) => {
    const key = keys[poolIndex];
    const zeroForOne = key.currency0.toLowerCase() === tokenIn;
    const { result } = await client.simulateContract({ address: a.Quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" }] });
    return { out: result[0], gas: result[1] };
  };
  const fee = (n) => (n * 9970n) / 10_000n;
  const ethIn = (FIVE_USD * 10n ** 18n * ref.den) / (ref.num * 1_000_000n);
  const ethValueOfFive = (FIVE_USD * 10n ** 18n * ref.den) / (ref.num * 1_000_000n);
  const usdValueOfEthIn = (ethIn * ref.num * 1_000_000n) / (10n ** 18n * ref.den);
  const spec = [
    ["buy ETH-YES ($5 USDG-YES -> ETH-YES)", 0, yesUsd, FIVE_USD, ethValueOfFive],
    ["buy ETH-NO  ($5 USDG-NO -> ETH-NO)", 1, noUsd, FIVE_USD, ethValueOfFive],
    ["sell ETH-YES (~$5 ETH-YES -> USDG-YES)", 0, yesEth, ethIn, usdValueOfEthIn],
    ["sell ETH-NO  (~$5 ETH-NO -> USDG-NO)", 1, noEth, ethIn, usdValueOfEthIn],
  ];
  for (const [label, pool, tokenIn, amount, ideal] of spec) {
    const q = await quoteOne(pool, tokenIn, amount);
    const afterFee = fee(ideal);
    const impactBps = q.out >= afterFee ? 0n : ((afterFee - q.out) * 10_000n) / afterFee;
    rows.push({ direction: label, amountIn: amount.toString(), quotedOut: q.out.toString(), impactBpsExFee: Number(impactBps), meetsOnePercentTarget: impactBps <= 100n, gasEstimate: q.gas.toString() });
  }
  // Probability pool, measured on the product routes in the implementation plan (section 4.3 / 10.2):
  //  - buy: $5 USDG is split into 5 YES + 5 NO, the 5 opposite tickets are swapped, the user keeps 5 + out tickets;
  //  - exit: a $5 position swaps about half of it, merges the pair, and the swap leg bears the price impact.
  const EXIT_SWAP = 2_500_000n;
  for (const [side, opposite] of [["YES", noUsd], ["NO", yesUsd]]) {
    const buy = await quoteOne(2, opposite, FIVE_USD);
    const idealTotal = FIVE_USD + fee(FIVE_USD);
    const buyImpact = FIVE_USD + buy.out >= idealTotal ? 0n : ((idealTotal - (FIVE_USD + buy.out)) * 10_000n) / idealTotal;
    rows.push({ direction: `probability: buy ${side} with $5 (split + swap)`, amountIn: FIVE_USD.toString(), quotedOut: (FIVE_USD + buy.out).toString(), impactBpsExFee: Number(buyImpact), meetsOnePercentTarget: buyImpact <= 100n, gasEstimate: buy.gas.toString() });
    const selected = side === "YES" ? yesUsd : noUsd;
    const exit = await quoteOne(2, selected, EXIT_SWAP);
    const idealExit = fee(EXIT_SWAP);
    const exitImpact = exit.out >= idealExit ? 0n : ((idealExit - exit.out) * 10_000n) / idealExit;
    rows.push({ direction: `probability: exit $5 ${side} position (swap 2.5 + merge)`, amountIn: EXIT_SWAP.toString(), quotedOut: exit.out.toString(), impactBpsExFee: Number(exitImpact), meetsOnePercentTarget: exitImpact <= 100n, gasEstimate: exit.gas.toString() });
  }
  state.quotes = { measuredAt: now.toString(), rows };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(json(rows));
  if (rows.some((r) => !r.meetsOnePercentTarget)) { console.error("At least one direction misses the 1% opening-depth target; adjust ranges or amounts before activation."); process.exitCode = 2; }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
