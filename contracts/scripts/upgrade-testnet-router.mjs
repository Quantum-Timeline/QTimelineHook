import https from "node:https";
import { Resolver } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, custom, defineChain, getAddress, keccak256 } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const manifestPath = resolve(root, "deployments/robinhood-testnet-v2.json");
const expectedChainId = 46630;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

function makeTransport(rpcUrl, overrideIp) {
  const url = new URL(rpcUrl);
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let ip = overrideIp;
  return custom({ request: async ({ method, params }) => {
    if (!ip) ip = (await resolver.resolve4(url.hostname))[0];
    if (!ip) throw new Error("Testnet RPC did not resolve through independent DNS");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] });
    return new Promise((resolvePromise, reject) => {
      const req = https.request({ hostname: ip, servername: url.hostname, port: Number(url.port || 443), path: `${url.pathname}${url.search}`, method: "POST", headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, rejectUnauthorized: true }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(text);
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`RPC HTTP ${res.statusCode}`));
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

try {
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const artifact = JSON.parse(await readFile(resolve(root, "contracts/out/TimelineRouter.sol/TimelineRouter.json"), "utf8"));
  const key = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Missing testnet deployer key");
  const account = privateKeyToAccount(key);
  if (manifest.chainId !== expectedChainId || getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Wrong manifest or deployer; refusing deployment");
  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: expectedChainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const transport = makeTransport(rpcUrl, env.RH_TESTNET_RPC_IP);
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if (await client.getChainId() !== expectedChainId) throw new Error("Only Robinhood testnet 46630 is allowed");

  if (manifest.routerUpgrade?.probabilitySellMergesOptimally) {
    const address = getAddress(manifest.routerUpgrade.address);
    if (!(await client.getBytecode({ address }))) throw new Error("Recorded fixed router has no bytecode");
    console.log(`Fixed testnet router already deployed at ${address}`);
  } else {
    const previousAddress = getAddress(manifest.addresses.TimelineRouter);
    const previousDeployment = manifest.deployments.TimelineRouter;
    const bytecode = artifact.bytecode.object.startsWith("0x") ? artifact.bytecode.object : `0x${artifact.bytecode.object}`;
    const hash = await wallet.deployContract({ account, abi: artifact.abi, bytecode, args: [manifest.addresses.PoolManager, manifest.addresses.MarketRegistry] });
    console.log(`TimelineRouter deploy submitted: ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Corrected TimelineRouter deployment failed");
    const address = getAddress(receipt.contractAddress);
    const [manager, registry, code] = await Promise.all([
      client.readContract({ address, abi: artifact.abi, functionName: "poolManager" }),
      client.readContract({ address, abi: artifact.abi, functionName: "registry" }),
      client.getBytecode({ address }),
    ]);
    if (getAddress(manager) !== getAddress(manifest.addresses.PoolManager) || getAddress(registry) !== getAddress(manifest.addresses.MarketRegistry) || !code || code === "0x") throw new Error("Corrected router post-deploy verification failed");
    manifest.timelineRouterHistory ??= [];
    if (!manifest.timelineRouterHistory.some((entry) => getAddress(entry.address) === previousAddress)) {
      manifest.timelineRouterHistory.push({ address: previousAddress, ...previousDeployment });
    }
    if (!manifest.previousTimelineRouter) manifest.previousTimelineRouter = { address: previousAddress, ...previousDeployment };
    manifest.addresses.TimelineRouter = address;
    manifest.deployments.TimelineRouter = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeCodeHash: keccak256(code) };
    manifest.routerUpgrade = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), probabilitySellMergesOptimally: true };
    if (manifest.smokeMarket.testnetTrade) manifest.smokeMarket.testnetTrade.router = address;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Corrected TimelineRouter verified at ${address}; previous router ${previousAddress} remains recorded.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
