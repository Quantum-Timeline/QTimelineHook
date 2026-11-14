import https from "node:https";
import { Resolver } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { findBestProbabilitySell } from "../../apps/web/lib/probability-sell.mjs";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, custom, defineChain, getAddress, parseAbi, keccak256, toBytes } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const envPath = resolve(root, "contracts/.env");
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || (process.argv.includes("--short-testnet") ? "deployments/robinhood-testnet-short.json" : "deployments/robinhood-testnet-v2.json"));
const expectedChainId = 46630;
const marketArg = process.argv.find((arg) => arg.startsWith("--market="))?.slice("--market=".length);
const shortMarketKey = process.env.QTIMELINE_SHORT_MARKET || marketArg;
const zero = "0x0000000000000000000000000000000000000000";
const amountIn = 1_000_000n;
const minSqrtPrice = 4_295_128_740n;
const maxSqrtPrice = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

function rpcTransport(rpcUrl, overrideIp) {
  const url = new URL(rpcUrl);
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let ip = overrideIp;
  return custom({ request: async ({ method, params }) => {
    if (!ip) ip = (await resolver.resolve4(url.hostname))[0];
    if (!ip) throw new Error("Official Robinhood testnet RPC did not resolve through independent DNS");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] });
    return new Promise((resolvePromise, reject) => {
      const req = https.request({ hostname: ip, servername: url.hostname, port: Number(url.port || 443), path: `${url.pathname}${url.search}`, method: "POST", headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, rejectUnauthorized: true }, (res) => {
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
  } });
}

const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const factoryArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/MarketFactory.sol/MarketFactory.json"), "utf8"));
const registryArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/MarketRegistry.sol/MarketRegistry.json"), "utf8"));
const routerArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/TimelineRouter.sol/TimelineRouter.json"), "utf8"));

try {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const smoke = shortMarketKey ? manifest.shortMarkets?.[shortMarketKey] : manifest.smokeMarket;
  if (!smoke) throw new Error(`Unknown testnet market selection: ${shortMarketKey || "default smokeMarket"}`);
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Missing testnet deployer key in contracts/.env");
  const account = privateKeyToAccount(privateKey);
  if (manifest.chainId !== expectedChainId || getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Manifest/deployer mismatch; refusing to sign");
  if (!smoke.activated || smoke.liquiditySeed?.positionLiquidity?.length !== 3) throw new Error("The selected market must have three verified liquidity positions first");

  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: expectedChainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const transport = rpcTransport(rpcUrl, env.RH_TESTNET_RPC_IP);
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if (await client.getChainId() !== expectedChainId) throw new Error("Only Robinhood testnet chain ID 46630 is allowed");

  const marketId = smoke.marketId;
  const registry = getAddress(manifest.addresses.MarketRegistry);
  const factory = getAddress(manifest.addresses.MarketFactory);
  const router = getAddress(manifest.addresses.TimelineRouter);
  const usdg = getAddress(manifest.addresses.TestUSDG);
  const [market0, tokens, keys, block0] = await Promise.all([
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "market", args: [marketId] }),
    client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "tokens", args: [marketId] }),
    client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "poolKeys", args: [marketId] }),
    client.getBlock(),
  ]);
  if (!market0.activated || block0.timestamp < market0.opensAt || block0.timestamp >= market0.cutoffAt) {
    throw new Error(`Market trade window is not open yet; opensAt=${market0.opensAt}, chainTimestamp=${block0.timestamp}`);
  }
  if (market0.status === 1) {
    const sync = { address: registry, abi: registryArtifact.abi, functionName: "syncTime", args: [marketId] };
    await client.simulateContract({ account, ...sync });
    const hash = await wallet.writeContract({ account, ...sync });
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("MarketRegistry.syncTime failed");
    smoke.testnetTrade = { transactions: { syncTime: hash } };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  const market = await client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "market", args: [marketId] });
  if (market.status !== 2 || !market.activated) throw new Error(`Market status ${market.status} is not Open after time sync`);

  const test = smoke.testnetTrade ?? { transactions: {} };
  test.transactions ??= {};
  const save = async () => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const send = async (step, address, abi, functionName, args, value = 0n) => {
    const request = { address, abi, functionName, args, value };
    await client.simulateContract({ account, ...request });
    const hash = await wallet.writeContract({ account, ...request });
    console.log(`${step}: ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`${step} reverted`);
    test.transactions[step] = hash;
    smoke.testnetTrade = test;
    await save();
    return hash;
  };
  const ensureAllowance = async (step, token, amount) => {
    const allowance = await client.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [account.address, router] });
    if (allowance >= amount) return;
    await send(step, token, tokenAbi, "approve", [router, amount]);
  };
  const quote = async (key, input, amount) => {
    if (key.currency0.toLowerCase() !== input.toLowerCase() && key.currency1.toLowerCase() !== input.toLowerCase()) throw new Error("Trade input is absent from selected pool");
    const zeroForOne = key.currency0.toLowerCase() === input.toLowerCase();
    const result = await client.readContract({ address: manifest.addresses.Quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" }] });
    if (result[0] <= 0n) throw new Error("Quoter returned no output");
    return { amountOut: result[0], zeroForOne };
  };
  const deadline = async () => (await client.getBlock()).timestamp + 300n;
  const nonce = async () => client.readContract({ address: router, abi: routerArtifact.abi, functionName: "nonces", args: [account.address] });
  const minimum = (quoteOut) => quoteOut * 9_900n / 10_000n;
  const sqrtLimit = (zeroForOne) => zeroForOne ? minSqrtPrice : maxSqrtPrice - 1n;

  if (!test.transactions.probabilityBuy) {
    await ensureAllowance("approveProbabilityBuy", usdg, amountIn);
    const quoteInfo = await quote(keys[2], tokens[3], amountIn);
    const request = {
      marketId, vault: market.vault, key: keys[2], asset: usdg, recipient: account.address, yes: true,
      zeroForOne: quoteInfo.zeroForOne, amountIn, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("probabilityBuy", router, routerArtifact.abi, "buyProbability", [request]);
  }

  if (!test.transactions.ethAssetBuy) {
    await ensureAllowance("approveEthAssetBuy", usdg, amountIn);
    test.ethYesBalanceBeforeBuy = (await client.readContract({ address: tokens[0], abi: tokenAbi, functionName: "balanceOf", args: [account.address] })).toString();
    smoke.testnetTrade = test;
    await save();
    const quoteInfo = await quote(keys[0], tokens[2], amountIn);
    const request = {
      marketId, vault: market.vault, key: keys[0], assetIn: usdg, assetOut: zero, recipient: account.address, yes: true,
      zeroForOne: quoteInfo.zeroForOne, amountIn, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("ethAssetBuy", router, routerArtifact.abi, "tradeAsset", [request]);
  }

  if (!test.transactions.ethAssetSell) {
    const yesEth = getAddress(tokens[0].toLowerCase());
    const noUsdg = getAddress(tokens[3].toLowerCase());
    const [ethAfterBuy, noBalance] = await Promise.all([
      client.readContract({ address: yesEth, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: noUsdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    ]);
    const ethBought = ethAfterBuy - BigInt(test.ethYesBalanceBeforeBuy ?? "0");
    if (ethBought === 0n || noBalance === 0n) throw new Error("ETH asset buy did not leave the expected YES and paired NO balances");
    await ensureAllowance("approveEthAssetSell", yesEth, ethBought);
    await ensureAllowance("approveEthAssetMergePair", noUsdg, noBalance);
    const quoteInfo = await quote(keys[0], yesEth, ethBought);
    const request = {
      marketId, vault: market.vault, key: keys[0], assetIn: zero, assetOut: usdg, recipient: account.address, yes: true,
      zeroForOne: quoteInfo.zeroForOne, amountIn: ethBought, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("ethAssetSell", router, routerArtifact.abi, "closeConditional", [request]);
  }

  if (!test.transactions.probabilitySellCollateral) {
    const yesToken = getAddress(tokens[2].toLowerCase());
    const [yesBalance, usdgBefore] = await Promise.all([
      client.readContract({ address: yesToken, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: usdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    ]);
    const totalAmount = yesBalance < amountIn ? yesBalance : amountIn;
    if (totalAmount < 2n) throw new Error("Not enough YES claims remain for a partial probability sell");
    await ensureAllowance("approveProbabilitySellCollateral", yesToken, totalAmount);
    const probabilityZeroForOne = keys[2].currency0.toLowerCase() === yesToken.toLowerCase();
    const sellPlan = await findBestProbabilitySell(totalAmount, async (exactAmount) => {
      try { return (await quote(keys[2], yesToken, exactAmount)).amountOut; }
      catch (error) {
        if (error instanceof Error && error.message === "Quoter returned no output") return undefined;
        throw error;
      }
    });
    const request = {
      marketId, vault: market.vault, key: keys[2], asset: usdg, recipient: account.address, yes: true,
      zeroForOne: probabilityZeroForOne, amountIn: totalAmount, swapAmount: sellPlan.swapAmount,
      minAmountOut: minimum(sellPlan.collateralOut), sqrtPriceLimitX96: sqrtLimit(probabilityZeroForOne),
      deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("probabilitySellCollateral", router, routerArtifact.abi, "sellProbability", [request]);
    const usdgAfter = await client.readContract({ address: usdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
    const payout = usdgAfter - usdgBefore;
    if (payout < request.minAmountOut || payout !== sellPlan.collateralOut) throw new Error("Probability sell did not return its quoted merged USDG payout");
    test.probabilitySellCollateral = {
      totalAmount: totalAmount.toString(), swapAmount: sellPlan.swapAmount.toString(),
      swapOut: sellPlan.swapOut.toString(), collateralOut: payout.toString(),
    };
    await save();
  }

  if (!test.transactions.probabilityBuyNo) {
    await ensureAllowance("approveProbabilityBuyNo", usdg, amountIn);
    const yesToken = getAddress(tokens[2].toLowerCase());
    const quoteInfo = await quote(keys[2], yesToken, amountIn);
    const request = {
      marketId, vault: market.vault, key: keys[2], asset: usdg, recipient: account.address, yes: false,
      zeroForOne: quoteInfo.zeroForOne, amountIn, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("probabilityBuyNo", router, routerArtifact.abi, "buyProbability", [request]);
  }

  if (!test.transactions.probabilitySellNoCollateral) {
    const noToken = getAddress(tokens[3].toLowerCase());
    const [noBalance, usdgBefore] = await Promise.all([
      client.readContract({ address: noToken, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: usdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    ]);
    const totalAmount = noBalance < amountIn ? noBalance : amountIn;
    if (totalAmount < 2n) throw new Error("Not enough NO claims remain for a partial probability sell");
    await ensureAllowance("approveProbabilitySellNo", noToken, totalAmount);
    const probabilityZeroForOne = keys[2].currency0.toLowerCase() === noToken.toLowerCase();
    const sellPlan = await findBestProbabilitySell(totalAmount, async (exactAmount) => {
      try { return (await quote(keys[2], noToken, exactAmount)).amountOut; }
      catch (error) {
        if (error instanceof Error && error.message === "Quoter returned no output") return undefined;
        throw error;
      }
    });
    const request = {
      marketId, vault: market.vault, key: keys[2], asset: usdg, recipient: account.address, yes: false,
      zeroForOne: probabilityZeroForOne, amountIn: totalAmount, swapAmount: sellPlan.swapAmount,
      minAmountOut: minimum(sellPlan.collateralOut), sqrtPriceLimitX96: sqrtLimit(probabilityZeroForOne),
      deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("probabilitySellNoCollateral", router, routerArtifact.abi, "sellProbability", [request]);
    const usdgAfter = await client.readContract({ address: usdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
    const payout = usdgAfter - usdgBefore;
    if (payout < request.minAmountOut || payout !== sellPlan.collateralOut) throw new Error("NO probability sell did not return its quoted merged USDG payout");
    test.probabilitySellNoCollateral = {
      totalAmount: totalAmount.toString(), swapAmount: sellPlan.swapAmount.toString(),
      swapOut: sellPlan.swapOut.toString(), collateralOut: payout.toString(),
    };
    await save();
  }

  if (!test.transactions.ethAssetBuyNo) {
    await ensureAllowance("approveEthAssetBuyNo", usdg, amountIn);
    test.ethNoBalanceBeforeBuy = (await client.readContract({ address: tokens[1], abi: tokenAbi, functionName: "balanceOf", args: [account.address] })).toString();
    await save();
    const noUsdg = getAddress(tokens[3].toLowerCase());
    const quoteInfo = await quote(keys[1], noUsdg, amountIn);
    const request = {
      marketId, vault: market.vault, key: keys[1], assetIn: usdg, assetOut: zero, recipient: account.address, yes: false,
      zeroForOne: quoteInfo.zeroForOne, amountIn, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("ethAssetBuyNo", router, routerArtifact.abi, "tradeAsset", [request]);
  }

  if (!test.transactions.ethAssetSellNo) {
    const noEth = getAddress(tokens[1].toLowerCase());
    const yesUsdg = getAddress(tokens[2].toLowerCase());
    const [ethAfterBuy, pairBalance] = await Promise.all([
      client.readContract({ address: noEth, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: yesUsdg, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    ]);
    const ethBought = ethAfterBuy - BigInt(test.ethNoBalanceBeforeBuy ?? "0");
    if (ethBought === 0n || pairBalance === 0n) throw new Error("NO ETH asset buy did not leave expected NO and paired YES claims");
    await ensureAllowance("approveEthAssetSellNo", noEth, ethBought);
    await ensureAllowance("approveEthAssetMergePairNo", yesUsdg, pairBalance);
    const quoteInfo = await quote(keys[1], noEth, ethBought);
    const request = {
      marketId, vault: market.vault, key: keys[1], assetIn: zero, assetOut: usdg, recipient: account.address, yes: false,
      zeroForOne: quoteInfo.zeroForOne, amountIn: ethBought, minAmountOut: minimum(quoteInfo.amountOut),
      sqrtPriceLimitX96: sqrtLimit(quoteInfo.zeroForOne), deadline: await deadline(), nonce: await nonce(), expectedConfigHash: market.configHash,
    };
    await send("ethAssetSellNo", router, routerArtifact.abi, "closeConditional", [request]);
  }

  test.complete = true;
  smoke.testnetTrade = test;
  const finalMarket = await client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "market", args: [marketId] });
  const marketStatuses = ["Draft", "Scheduled", "Open", "Awaiting result", "Final YES", "Final NO", "Cancelled", "Discarded"];
  smoke.status = marketStatuses[Number(finalMarket.status)] ?? "Unknown";
  smoke.activated = Boolean(finalMarket.activated);
  if (smoke === manifest.smokeMarket) manifest.marketActivated = Boolean(finalMarket.activated);
  manifest.note = finalMarket.activated
    ? `Testnet-only smoke market ${shortMarketKey || "smokeMarket"} is activated (${smoke.status}); chain time and cutoff control trading.`
    : `Testnet-only smoke market ${shortMarketKey || "smokeMarket"} is not activated (${smoke.status}).`;
  await save();
  console.log("Robinhood testnet trade smoke complete: probability buy/sell and ETH asset buy/sell receipts confirmed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
