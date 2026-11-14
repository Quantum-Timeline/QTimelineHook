import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildWithdrawalPlan } from "./lib/withdraw-liquidity-plan.mjs";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, getAddress, http, parseAbiItem, parseEventLogs } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-fixed-vault.json");
const envPath = resolve(root, "contracts/.env");
const expectedChainId = 46630;
const positionManager = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const zeroAddress = "0x0000000000000000000000000000000000000000";

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

const factoryAbi = JSON.parse(await readFile(resolve(root, "contracts/out/MarketFactory.sol/MarketFactory.json"), "utf8")).abi;
const registryAbi = JSON.parse(await readFile(resolve(root, "contracts/out/MarketRegistry.sol/MarketRegistry.json"), "utf8")).abi;
const vaultAbi = JSON.parse(await readFile(resolve(root, "contracts/out/ConditionalVault.sol/ConditionalVault.json"), "utf8")).abi;
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
];
const positionManagerAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getPositionLiquidity", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ name: "unlockData", type: "bytes" }, { name: "deadline", type: "uint256" }], outputs: [] },
];

try {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const marketRecord = manifest.smokeMarket;
  if (!marketRecord?.marketId || !marketRecord.liquiditySeed?.positionIds?.length) throw new Error("Manifest does not contain a seeded smoke market");
  if (manifest.chainId !== expectedChainId) throw new Error("Only Robinhood testnet 46630 is allowed");
  const account = privateKeyToAccount(env.RH_TESTNET_DEPLOYER_PRIVATE_KEY);
  if (getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Manifest deployer does not match the configured testnet wallet");
  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: expectedChainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== expectedChainId) throw new Error("Connected RPC is not Robinhood testnet 46630");

  const marketId = marketRecord.marketId;
  const [market, keys, tokenAddresses] = await Promise.all([
    publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryAbi, functionName: "market", args: [marketId] }),
    publicClient.readContract({ address: manifest.addresses.MarketFactory, abi: factoryAbi, functionName: "poolKeys", args: [marketId] }),
    publicClient.readContract({ address: manifest.addresses.MarketFactory, abi: factoryAbi, functionName: "tokens", args: [marketId] }),
  ]);
  const status = Number(market.status);
  if (status !== 4 && status !== 5 && status !== 6) throw new Error(`LP exit smoke requires FinalYes, FinalNo, or Cancelled; status=${status}`);
  const positions = [];
  for (let i = 0; i < marketRecord.liquiditySeed.positionIds.length; i++) {
    const tokenId = BigInt(marketRecord.liquiditySeed.positionIds[i]);
    const [owner, liquidity] = await Promise.all([
      publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] }),
      publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
    ]);
    if (getAddress(owner) !== getAddress(account.address)) throw new Error(`Position ${tokenId} is not owned by the configured treasury wallet`);
    if (liquidity === 0n) continue;
    positions.push({ tokenId, liquidity, key: keys[i] });
  }
  if (!positions.length) throw new Error("All manifest LP positions already have zero liquidity; nothing to withdraw");

  const plan = buildWithdrawalPlan(positions, account.address);
  const encodedParams = plan.params.map((param) => param.type === "decrease"
    ? encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [param.tokenId, param.liquidity, 0n, 0n, "0x"])
    : encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [param.key.currency0, param.key.currency1, account.address]));
  const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [plan.actions, encodedParams]);
  const withdrawalRequest = { account, address: positionManager, abi: positionManagerAbi, functionName: "modifyLiquidities", args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 300)] };
  await publicClient.simulateContract(withdrawalRequest);
  const withdrawalTx = await walletClient.writeContract(withdrawalRequest);
  console.log(`Liquidity withdrawal submitted: ${withdrawalTx}`);
  const withdrawalReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawalTx, confirmations: 1 });
  if (withdrawalReceipt.status !== "success") throw new Error("PositionManager liquidity withdrawal reverted");
  const remainingLiquidity = await Promise.all(positions.map(({ tokenId }) => publicClient.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] })));
  if (remainingLiquidity.some((liquidity) => liquidity !== 0n)) throw new Error("PositionManager still reports liquidity after full withdrawal");

  const vault = getAddress(market.vault);
  const redemptions = [];
  const redeemEvent = parseAbiItem("event Redeem(address indexed caller,address indexed asset,address indexed recipient,bool yes,uint256 amount,uint256 payout)");
  for (const [asset, yesIndex, noIndex] of [[zeroAddress, 0, 1], [manifest.addresses.TestUSDG, 2, 3]]) {
    for (const [yes, token] of [[true, tokenAddresses[yesIndex]], [false, tokenAddresses[noIndex]]]) {
      const amount = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      if (amount === 0n) continue;
      const request = { account, address: vault, abi: vaultAbi, functionName: "redeem", args: [asset, yes, amount, account.address] };
      await publicClient.simulateContract(request);
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error(`LP token redemption reverted for ${yes ? "YES" : "NO"} ${asset}`);
      const [event] = parseEventLogs({ abi: [redeemEvent], logs: receipt.logs, eventName: "Redeem" });
      if (!event || event.args.amount !== amount) throw new Error("Could not verify the full amount burned in the vault redemption receipt");
      redemptions.push({ asset, side: yes ? "YES" : "NO", amount: amount.toString(), payout: event.args.payout.toString(), transactionHash: hash });
    }
  }
  const remainingClaims = await Promise.all(tokenAddresses.map((token) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })));
  if (remainingClaims.some((amount) => amount !== 0n)) throw new Error("Treasury still holds outcome tokens after LP claim redemption");
  const result = {
    testnetOnly: true,
    status: status === 4 ? "Final YES" : status === 5 ? "Final NO" : "Cancelled",
    cutoffAt: market.cutoffAt.toString(),
    positionIds: positions.map(({ tokenId }) => tokenId.toString()),
    withdrawnLiquidity: positions.map(({ liquidity }) => liquidity.toString()),
    remainingPositionLiquidity: remainingLiquidity.map(String),
    withdrawalTransaction: withdrawalTx,
    withdrawalBlock: withdrawalReceipt.blockNumber.toString(),
    redemptions,
    completedAt: new Date().toISOString(),
  };
  marketRecord.liquidityWithdrawal = result;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
