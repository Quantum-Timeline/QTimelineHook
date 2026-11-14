import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, getAddress, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-stale-status.json");
const zeroAddress = "0x0000000000000000000000000000000000000000";

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

async function waitUntil(publicClient, target) {
  while ((await publicClient.getBlock()).timestamp < target) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  return publicClient.getBlock();
}

const registryAbi = JSON.parse(await readFile(resolve(root, "contracts/out/MarketRegistry.sol/MarketRegistry.json"), "utf8")).abi;
const vaultAbi = JSON.parse(await readFile(resolve(root, "contracts/out/ConditionalVault.sol/ConditionalVault.json"), "utf8")).abi;

try {
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const smoke = manifest.smokeMarket;
  if (manifest.chainId !== 46630 || !smoke?.activated) throw new Error("Expected an activated testnet market");
  const account = privateKeyToAccount(env.RH_TESTNET_DEPLOYER_PRIVATE_KEY);
  if (getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Manifest deployer mismatch");
  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== 46630) throw new Error("Connected RPC is not Robinhood testnet 46630");

  const marketId = smoke.marketId;
  const registry = getAddress(manifest.addresses.MarketRegistry);
  const market = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] });
  let status = Number(market.status);
  if (status === 1) {
    await waitUntil(publicClient, market.opensAt);
    const sync = { account, address: registry, abi: registryAbi, functionName: "syncTime", args: [marketId] };
    await publicClient.simulateContract(sync);
    const syncTx = await walletClient.writeContract(sync);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: syncTx, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("Could not set market status to Open at opensAt");
    smoke.openStatusSync = syncTx;
    status = Number((await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] })).status);
  }
  if (status !== 2) throw new Error(`Need a stale Open market before cutoff; current status=${status}`);

  await waitUntil(publicClient, market.cutoffAt);
  const staleMarket = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] });
  if (Number(staleMarket.status) !== 2) throw new Error("Registry status changed without this smoke's syncTime call; stale Open precondition was not met");
  const assets = [zeroAddress, getAddress(manifest.addresses.TestUSDG)];
  const results = [];
  for (const asset of assets) {
    try {
      await publicClient.simulateContract({
        account,
        address: getAddress(market.vault),
        abi: vaultAbi,
        functionName: "split",
        args: [asset, 1n, account.address],
        ...(asset === zeroAddress ? { value: 1n } : {}),
      });
    } catch (error) {
      const message = `${error?.shortMessage || ""} ${error?.message || ""}`;
      if (!message.includes("InvalidState")) throw new Error(`Expected InvalidState for split ${asset}, got ${message.slice(0, 500)}`);
      results.push({ asset, rejected: true, error: "InvalidState" });
      continue;
    }
    throw new Error(`Split for ${asset} unexpectedly simulated successfully after cutoff while status was Open`);
  }
  smoke.staleSplitGuard = {
    testnetOnly: true,
    status: "Open (not synced after cutoff)",
    cutoffAt: market.cutoffAt.toString(),
    chainTimestamp: (await publicClient.getBlock()).timestamp.toString(),
    assets: results,
    behavior: "Native ETH and USDG split calls both reject at timestamp >= cutoff despite stale Open registry status.",
    completedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(smoke.staleSplitGuard, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
