import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildWithdrawalPlan } from "./lib/withdraw-liquidity-plan.mjs";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, decodeErrorResult, defineChain, encodeAbiParameters, getAddress, http, keccak256, parseAbi, toBytes } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-cutoff.json");
const managerAddress = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const errorSelector = keccak256(toBytes("MarketNotTradable(uint8,uint64,uint64)")).slice(0, 10).toLowerCase();

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
const managerAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getPositionLiquidity", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ name: "unlockData", type: "bytes" }, { name: "deadline", type: "uint256" }], outputs: [] },
];

try {
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const smoke = manifest.smokeMarket;
  if (manifest.chainId !== 46630 || !smoke?.marketId || !smoke.liquiditySeed?.positionIds?.length) throw new Error("Expected a seeded Robinhood testnet market manifest");
  const account = privateKeyToAccount(env.RH_TESTNET_DEPLOYER_PRIVATE_KEY);
  if (getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Configured wallet does not match the manifest deployer");
  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== 46630) throw new Error("Connected RPC is not Robinhood testnet 46630");

  const [block, market, keys] = await Promise.all([
    publicClient.getBlock(),
    publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryAbi, functionName: "market", args: [smoke.marketId] }),
    publicClient.readContract({ address: manifest.addresses.MarketFactory, abi: factoryAbi, functionName: "poolKeys", args: [smoke.marketId] }),
  ]);
  if (block.timestamp < market.cutoffAt) throw new Error(`Cutoff has not elapsed; current=${block.timestamp}, cutoff=${market.cutoffAt}`);

  let status = Number(market.status);
  if (status === 1 || status === 2) {
    const sync = { account, address: manifest.addresses.MarketRegistry, abi: registryAbi, functionName: "syncTime", args: [smoke.marketId] };
    await publicClient.simulateContract(sync);
    const syncTx = await walletClient.writeContract(sync);
    const syncReceipt = await publicClient.waitForTransactionReceipt({ hash: syncTx, confirmations: 1 });
    if (syncReceipt.status !== "success") throw new Error("Could not sync market status at cutoff");
  }
  const currentMarket = await publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryAbi, functionName: "market", args: [smoke.marketId] });
  status = Number(currentMarket.status);
  if (status !== 3) throw new Error(`Expected AwaitingResult after cutoff, got status=${status}`);

  const quoterAbi = parseAbi([
    "error MarketNotTradable(uint8 status,uint64 opensAt,uint64 cutoffAt)",
    "error UnexpectedRevertBytes(bytes revertData)",
    "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  ]);
  let directSwapRevert = "";
  let nestedRevertData = "";
  try {
    await publicClient.readContract({
      address: manifest.addresses.Quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: keys[2], zeroForOne: true, exactAmount: 1n, hookData: "0x" }],
    });
  } catch (error) {
    directSwapRevert = error instanceof Error ? error.message : String(error);
    const data = error?.data ?? error?.cause?.data;
    const wrappedPayload = [...directSwapRevert.matchAll(/0x[0-9a-fA-F]{64,}/g)].map(([value]) => value).sort((a, b) => b.length - a.length)[0];
    if (typeof data === "string") {
      try {
        const decoded = decodeErrorResult({ abi: quoterAbi, data });
        if (decoded.errorName === "UnexpectedRevertBytes") {
          const wrapped = decodeErrorResult({ abi: quoterAbi, data: decoded.args[0] });
          if (wrapped.errorName === "WrappedError") nestedRevertData = wrapped.args[2].toLowerCase();
        }
      } catch {}
    }
    if (!nestedRevertData && wrappedPayload) {
      try {
        const wrapped = decodeErrorResult({ abi: quoterAbi, data: wrappedPayload });
        if (wrapped.errorName === "WrappedError") nestedRevertData = wrapped.args[2].toLowerCase();
      } catch {}
    }
    if (!nestedRevertData.startsWith(errorSelector)) throw new Error(`Direct PoolManager swap reverted for an unexpected reason: ${directSwapRevert.slice(0, 800)}; nested=${nestedRevertData.slice(0, 10) || "unavailable"}`);
  }
  if (!directSwapRevert) throw new Error("Direct PositionManager/PoolManager swap unexpectedly simulated successfully after cutoff");

  const positions = [];
  for (let i = 0; i < smoke.liquiditySeed.positionIds.length; i++) {
    const tokenId = BigInt(smoke.liquiditySeed.positionIds[i]);
    const [owner, liquidity] = await Promise.all([
      publicClient.readContract({ address: managerAddress, abi: managerAbi, functionName: "ownerOf", args: [tokenId] }),
      publicClient.readContract({ address: managerAddress, abi: managerAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
    ]);
    if (getAddress(owner) !== getAddress(account.address)) throw new Error(`Position ${tokenId} is not owned by the treasury wallet`);
    if (liquidity > 0n) positions.push({ tokenId, liquidity, key: keys[i] });
  }
  if (!positions.length) throw new Error("No non-zero treasury LP positions found for the cutoff withdrawal check");
  const plan = buildWithdrawalPlan(positions, account.address);
  const encodedParams = plan.params.map((param) => param.type === "decrease"
    ? encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }], [param.tokenId, param.liquidity, 0n, 0n, "0x"])
    : encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [param.key.currency0, param.key.currency1, account.address]));
  const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [plan.actions, encodedParams]);
  const withdrawRequest = { account, address: managerAddress, abi: managerAbi, functionName: "modifyLiquidities", args: [unlockData, BigInt(block.timestamp + 300n)] };
  await publicClient.simulateContract(withdrawRequest);
  const withdrawalTx = await walletClient.writeContract(withdrawRequest);
  const withdrawalReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawalTx, confirmations: 1 });
  if (withdrawalReceipt.status !== "success") throw new Error("LP withdrawal at cutoff reverted");
  const remainingLiquidity = await Promise.all(positions.map(({ tokenId }) => publicClient.readContract({ address: managerAddress, abi: managerAbi, functionName: "getPositionLiquidity", args: [tokenId] })));
  if (remainingLiquidity.some((liquidity) => liquidity !== 0n)) throw new Error("LP positions did not fully close at cutoff");

  smoke.cutoffSmoke = {
    testnetOnly: true,
    marketStatus: "AwaitingResult",
    blockTimestamp: block.timestamp.toString(),
    cutoffAt: market.cutoffAt.toString(),
    directPoolManagerSwap: "reverted with MarketNotTradable(uint8,uint64,uint64)",
    directSwapSelector: errorSelector,
    directSwapRoute: "Quoter callback -> PoolManager.swap -> TimelineHook (no TimelineRouter)",
    withdrawalTransaction: withdrawalTx,
    withdrawalBlock: withdrawalReceipt.blockNumber.toString(),
    positions: positions.map(({ tokenId, liquidity }) => ({ tokenId: tokenId.toString(), withdrawnLiquidity: liquidity.toString() })),
    remainingLiquidity: remainingLiquidity.map(String),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(smoke.cutoffSmoke, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
