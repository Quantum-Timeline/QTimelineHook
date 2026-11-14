import https from "node:https";
import { Resolver } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { concatHex, createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, getAddress, keccak256, toBytes, toHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const root = process.cwd();
const envPath = resolve(root, "contracts/.env");
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || (process.argv.includes("--short-testnet") ? "deployments/robinhood-testnet-short.json" : "deployments/robinhood-testnet-v2.json"));
const expectedChainId = 46630;
const marketArg = process.argv.find((arg) => arg.startsWith("--market="))?.slice("--market=".length);
const shortMarketKey = process.env.QTIMELINE_SHORT_MARKET || marketArg;
const positionManager = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const liquidity = 100_000_000n;
const amountMax = 100_000_000n;
const ethSplit = 1_000_000_000n;
const usdgSplit = 200_000_000n;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

function requestHttps(url, body, ip) {
  return new Promise((resolvePromise, reject) => {
    const req = https.request({
      hostname: ip, servername: url.hostname, port: Number(url.port || 443), path: `${url.pathname}${url.search}`,
      method: "POST", headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, rejectUnauthorized: true,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(text);
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`RPC HTTP status ${res.statusCode}`));
          if (json.error) return reject(new Error(`RPC ${json.error.code}: ${json.error.message}`));
          resolvePromise(json.result);
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("RPC request timed out")));
    req.end(body);
  });
}

function makePinnedRpcTransport(rpcUrl, overrideIp) {
  const url = new URL(rpcUrl);
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let cachedIp = overrideIp;
  return custom({ request: async ({ method, params }) => {
    if (!cachedIp) {
      const ips = await resolver.resolve4(url.hostname);
      if (!ips.length) throw new Error("Official testnet RPC did not resolve through independent DNS");
      cachedIp = ips[0];
    }
    return requestHttps(url, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }), cachedIp);
  } });
}

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const vaultAbi = [
  { type: "function", name: "split", stateMutability: "payable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
];
const permit2Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }], outputs: [] },
];
const positionManagerAbi = [
  { type: "function", name: "nextTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getPositionLiquidity", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ name: "unlockData", type: "bytes" }, { name: "deadline", type: "uint256" }], outputs: [] },
];
const factoryArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/MarketFactory.sol/MarketFactory.json"), "utf8"));
const poolManagerAbi = [
  { type: "function", name: "extsload", stateMutability: "view", inputs: [{ name: "slot", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
];
const activateAbi = factoryArtifact.abi.filter((item) => item.type === "function" && item.name === "activateMarket");

try {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const smoke = shortMarketKey ? manifest.shortMarkets?.[shortMarketKey] : manifest.smokeMarket;
  if (!smoke) throw new Error(`Unknown testnet market selection: ${shortMarketKey || "default smokeMarket"}`);
  smoke.liquiditySeed ??= {};
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Missing testnet deployer key in contracts/.env");
  const account = privateKeyToAccount(privateKey);
  if (manifest.chainId !== expectedChainId || getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Testnet manifest or deployer mismatch; refusing to sign");
  if (!smoke.marketId || smoke.activated) throw new Error("Expected an existing, inactive smoke market");

  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: expectedChainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const transport = makePinnedRpcTransport(rpcUrl, env.RH_TESTNET_RPC_IP);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== expectedChainId) throw new Error(`Wrong chain ${chainId}; only Robinhood testnet ${expectedChainId} is allowed`);

  const marketId = smoke.marketId;
  const factoryAddress = getAddress(manifest.addresses.MarketFactory);
  const registryAddress = getAddress(manifest.addresses.MarketRegistry);
  const factory = factoryArtifact.abi;
  const registryArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/MarketRegistry.sol/MarketRegistry.json"), "utf8"));
  const registry = registryArtifact.abi;
  const [market, rawTokens, keys, usdgBalance, ethBalance, permit2Code, positionCode] = await Promise.all([
    publicClient.readContract({ address: registryAddress, abi: registry, functionName: "market", args: [marketId] }),
    publicClient.readContract({ address: factoryAddress, abi: factory, functionName: "tokens", args: [marketId] }),
    publicClient.readContract({ address: factoryAddress, abi: factory, functionName: "poolKeys", args: [marketId] }),
    publicClient.readContract({ address: manifest.addresses.TestUSDG, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.getBalance({ address: account.address }),
    publicClient.getBytecode({ address: permit2Address }),
    publicClient.getBytecode({ address: positionManager }),
  ]);
  if (market.status !== 0 || market.activated || (smoke.vault && market.vault.toLowerCase() !== smoke.vault.toLowerCase())) throw new Error("Market is no longer the expected inactive Draft");
  smoke.vault = getAddress(market.vault);
  const tokens = rawTokens.map((token) => getAddress(token.toLowerCase()));
  if (ethBalance < 5_000_000_000_000_000n) throw new Error("Insufficient testnet ETH for gas");
  if (!permit2Code || permit2Code === "0x" || !positionCode || positionCode === "0x") throw new Error("Permit2 or PositionManager has no bytecode");

  const poolIds = keys.map((key) => keccak256(toBytes(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  ))));
  const registeredPools = await Promise.all(poolIds.map((id) => publicClient.readContract({ address: registryAddress, abi: registry, functionName: "isRegisteredPool", args: [marketId, id] })));
  if (registeredPools.some((registered) => !registered)) throw new Error("Computed pool ID does not match the market registry");
  const liquiditySlots = poolIds.map((id) => {
    const poolStateSlot = keccak256(concatHex([id, toHex(6n, { size: 32 })]));
    return toHex(BigInt(poolStateSlot) + 3n, { size: 32 });
  });
  const currentLiquidity = await Promise.all(liquiditySlots.map(async (slot) => BigInt(await publicClient.readContract({ address: manifest.addresses.PoolManager, abi: poolManagerAbi, functionName: "extsload", args: [slot] }))));
  if (currentLiquidity.some((value) => value !== 0n && value !== liquidity)) throw new Error("A market pool has unexpected liquidity; refusing to duplicate or alter positions");

  const usdAddress = getAddress(manifest.addresses.TestUSDG);
  let splitEthHash = smoke.liquiditySeed?.transactions?.nativeSplit;
  let splitUsdHash = smoke.liquiditySeed?.transactions?.usdgSplit;
  const initialOutcomeBalances = await Promise.all(tokens.map((token) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  if (initialOutcomeBalances.slice(0, 2).some((balance) => balance < amountMax)) {
    if (ethBalance < ethSplit + 5_000_000_000_000_000n) throw new Error("Insufficient testnet ETH for bounded liquidity seed and gas");
    const splitEth = { address: market.vault, abi: vaultAbi, functionName: "split", args: ["0x0000000000000000000000000000000000000000", ethSplit, account.address], value: ethSplit };
    await publicClient.simulateContract({ account, ...splitEth });
    splitEthHash = await walletClient.writeContract({ account, ...splitEth });
    console.log(`Native collateral split submitted: ${splitEthHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: splitEthHash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("Native collateral split reverted");
  } else console.log("Reusing existing ETH outcome split.");
  if (initialOutcomeBalances.slice(2, 4).some((balance) => balance < amountMax)) {
    if (usdgBalance < usdgSplit) throw new Error("Insufficient USDG for bounded liquidity seed");
    const usdAllowance = await publicClient.readContract({ address: usdAddress, abi: erc20Abi, functionName: "allowance", args: [account.address, market.vault] });
    if (usdAllowance < usdgSplit) {
      const approval = { address: usdAddress, abi: erc20Abi, functionName: "approve", args: [market.vault, usdgSplit] };
      await publicClient.simulateContract({ account, ...approval });
      const hash = await walletClient.writeContract({ account, ...approval });
      console.log(`Vault USDG approval submitted: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("Vault USDG approval reverted");
    }
    const splitUsd = { address: market.vault, abi: vaultAbi, functionName: "split", args: [usdAddress, usdgSplit, account.address] };
    await publicClient.simulateContract({ account, ...splitUsd });
    splitUsdHash = await walletClient.writeContract({ account, ...splitUsd });
    console.log(`USDG collateral split submitted: ${splitUsdHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: splitUsdHash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("USDG collateral split reverted");
  } else console.log("Reusing existing USDG outcome split.");

  const uniqueTokens = [...new Set(tokens)];
  const tokenBal = await Promise.all(uniqueTokens.map((token) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  if (tokenBal.some((balance) => balance < amountMax)) throw new Error("Outcome collateral split did not produce the expected token amounts");
  const expiration = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const approvalTxs = smoke.liquiditySeed?.transactions?.approvals ?? [];
  for (const token of uniqueTokens) {
    const approvedAmount = token === tokens[2] || token === tokens[3] ? 2n * amountMax : amountMax;
    const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, permit2Address] });
    if (allowance < approvedAmount) {
      const approval = { address: token, abi: erc20Abi, functionName: "approve", args: [permit2Address, approvedAmount] };
      await publicClient.simulateContract({ account, ...approval });
      const hash = await walletClient.writeContract({ account, ...approval });
      console.log(`Outcome token approval submitted: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error(`Token approval reverted for ${token}`);
      approvalTxs.push(hash);
    }
    const [amount, currentExpiry] = await publicClient.readContract({ address: permit2Address, abi: permit2Abi, functionName: "allowance", args: [account.address, token, positionManager] });
    if (amount < approvedAmount || currentExpiry < expiration) {
      const approval = { address: permit2Address, abi: permit2Abi, functionName: "approve", args: [token, positionManager, approvedAmount, expiration] };
      await publicClient.simulateContract({ account, ...approval });
      const hash = await walletClient.writeContract({ account, ...approval });
      console.log(`Permit2 allowance submitted: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error(`Permit2 allowance reverted for ${token}`);
      approvalTxs.push(hash);
    }
  }

  smoke.liquiditySeed = {
    ...smoke.liquiditySeed,
    ethCollateral: ethSplit.toString(), usdgCollateral: usdgSplit.toString(), liquidity: liquidity.toString(),
    tickLower: -60_000, tickUpper: 60_000, poolIds,
    transactions: { ...smoke.liquiditySeed?.transactions, nativeSplit: splitEthHash, usdgSplit: splitUsdHash, approvals: approvalTxs, positions: smoke.liquiditySeed?.transactions?.positions ?? [] },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const mintTxs = smoke.liquiditySeed.transactions.positions;
  const positionIds = [];
  for (let i = 0; i < keys.length; i++) {
    if (currentLiquidity[i] === 0n) continue;
    const hash = mintTxs[i];
    if (!hash) throw new Error(`Pool ${i} already has liquidity but its mint transaction is missing from the manifest`);
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const transferTopic = keccak256(toBytes("Transfer(address,address,uint256)"));
    const ownerTopic = `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`;
    const transfer = receipt.logs.find((log) => log.address.toLowerCase() === positionManager.toLowerCase() && log.topics[0] === transferTopic && log.topics[1] === `0x${"0".repeat(64)}` && log.topics[2] === ownerTopic);
    if (receipt.status !== "success" || !transfer?.topics[3]) throw new Error(`Could not recover the NFT ID for existing pool ${i} position`);
    positionIds[i] = BigInt(transfer.topics[3]);
  }
  for (let i = 0; i < keys.length; i++) {
    if (currentLiquidity[i] === liquidity) {
      console.log(`Pool ${i} already has the expected LP position; resuming after it.`);
      continue;
    }
    const key = keys[i];
    const params = [
      encodeAbiParameters([
        { type: "tuple", components: [
          { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
        ] },
        { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" },
      ], [key, -60_000, 60_000, liquidity, amountMax, amountMax, account.address, "0x"]),
      encodeAbiParameters([{ type: "address" }, { type: "address" }], [key.currency0, key.currency1]),
    ];
    const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x020d", params]);
    const mint = { address: positionManager, abi: positionManagerAbi, functionName: "modifyLiquidities", args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 300)] };
    await publicClient.simulateContract({ account, ...mint });
    const hash = await walletClient.writeContract({ account, ...mint });
    console.log(`Pool ${i} LP mint submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`LP mint for pool ${i} reverted`);
    mintTxs[i] = hash;
    const transferTopic = keccak256(toBytes("Transfer(address,address,uint256)"));
    const ownerTopic = `0x${account.address.slice(2).toLowerCase().padStart(64, "0")}`;
    const transfer = receipt.logs.find((log) => log.address.toLowerCase() === positionManager.toLowerCase() && log.topics[0] === transferTopic && log.topics[1] === `0x${"0".repeat(64)}` && log.topics[2] === ownerTopic);
    if (!transfer?.topics[3]) throw new Error(`Could not recover the NFT ID for pool ${i} position`);
    positionIds[i] = BigInt(transfer.topics[3]);
    smoke.liquiditySeed.transactions.positions = mintTxs;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  const positionLiquidity = await Promise.all(positionIds.map((tokenId) => publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] })));
  if (positionLiquidity.some((value) => value !== liquidity)) throw new Error("PositionManager did not report all three expected liquidity positions");

  const activation = { address: factoryAddress, abi: activateAbi, functionName: "activateMarket", args: [marketId] };
  await publicClient.simulateContract({ account, ...activation });
  const activationHash = await walletClient.writeContract({ account, ...activation });
  console.log(`Market activation submitted: ${activationHash}`);
  const activationReceipt = await publicClient.waitForTransactionReceipt({ hash: activationHash, confirmations: 1 });
  if (activationReceipt.status !== "success") throw new Error("Market activation reverted");

  smoke.liquiditySeed = {
    ethCollateral: ethSplit.toString(), usdgCollateral: usdgSplit.toString(), liquidity: liquidity.toString(),
    tickLower: -60_000, tickUpper: 60_000, positionIds: positionIds.map(String),
    positionLiquidity: positionLiquidity.map(String), poolIds,
    transactions: { nativeSplit: splitEthHash, usdgSplit: splitUsdHash, approvals: approvalTxs, positions: mintTxs, activation: activationHash },
  };
  smoke.status = "Scheduled";
  smoke.activated = true;
  if (smoke === manifest.smokeMarket) manifest.marketActivated = true;
  manifest.note = "Testnet-only smoke market has three seeded v4 liquidity positions and is activated; trading remains time-gated until opensAt.";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Verified testnet activation for ${shortMarketKey || "smokeMarket"}. Pool liquidity: ${positionLiquidity.join(", ")}; opensAt: ${smoke.opensAt}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
