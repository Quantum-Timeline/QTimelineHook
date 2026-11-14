// Replaces the logic behind one proxy or beacon of the Anthropic IPO system. Deployer-only; dry run unless --broadcast.
//   QT_IPO_UPGRADE_TARGET   proxy key (IpoMarketRegistry, PQKeyRegistry, IpoMarketFactory, IpoResolutionAdapter, TimelineRouter)
//                           or beacon key (outcomeToken, vault)
//   QT_IPO_UPGRADE_CONTRACT artifact name of the new logic (for example IpoMarketRegistryV2). Rebuild first: pnpm contracts:build
// The hook beacon needs a CREATE2-mined implementation; deploy one through IpoHookDeployer.deployImplementation and call the beacon directly.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_CHAIN_ID, mainnetRpcUrl } from "./lib/mainnet-release-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, getAddress, keccak256 } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || "deployments/robinhood-mainnet-ipo.json");
const broadcast = process.argv.includes("--broadcast");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const artifact = (name) => readJson(resolve(root, `contracts/out/${name}.sol/${name}.json`));
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((l) => { const t = l.trim(); const i = t.indexOf("="); return !t || t.startsWith("#") || i < 1 ? [] : [[t.slice(0, i).trim(), t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]]; }));

async function main() {
  const target = process.env.QT_IPO_UPGRADE_TARGET;
  const contract = process.env.QT_IPO_UPGRADE_CONTRACT;
  if (!target || !contract) throw new Error("Set QT_IPO_UPGRADE_TARGET and QT_IPO_UPGRADE_CONTRACT");
  const manifest = await readJson(manifestPath);
  if (manifest.system !== "anthropic-ipo-pricing" || !manifest.upgradeControl) throw new Error("The manifest is not an upgradeable IPO deployment");
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const rpcUrl = mainnetRpcUrl({ override: process.env.QT_MAINNET_RPC, configured: env.RH_MAINNET_RPC });
  const account = privateKeyToAccount(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY);
  if (getAddress(account.address) !== getAddress(manifest.deployer)) throw new Error("The configured key is not the manifest deployer");
  const chain = defineChain({ id: MAINNET_CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: require("viem").http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: require("viem").http(rpcUrl) });
  if (await client.getChainId() !== MAINNET_CHAIN_ID) throw new Error("Wrong chain");

  const proxy = manifest.upgradeControl.proxies[target];
  const beacon = manifest.upgradeControl.beacons[target];
  if (!proxy && !beacon) throw new Error(`Unknown target ${target}`);
  if (target === "hook") throw new Error("Upgrade the hook beacon directly with a CREATE2-mined implementation");
  const item = await artifact(contract);
  const creation = item.bytecode?.object;
  if (!creation || creation.includes("__")) throw new Error(`${contract} artifact is empty or unlinked`);
  if (item.deployedBytecode.object.length / 2 - 1 > 24_576) throw new Error(`${contract} exceeds EIP-170`);
  const current = (proxy ?? beacon).implementation;
  console.log(JSON.stringify({ target, kind: proxy ? "proxy" : "beacon", current, newLogic: contract, broadcast }, null, 2));
  if (!broadcast) { console.log("Dry run. Add --broadcast to deploy the new logic and switch the target to it."); return; }

  const deployHash = await wallet.deployContract({ account, abi: item.abi, bytecode: `0x${creation.replace(/^0x/i, "")}` });
  const deployed = await client.waitForTransactionReceipt({ hash: deployHash });
  if (deployed.status !== "success") throw new Error("Logic deployment failed");
  const next = getAddress(deployed.contractAddress);
  let hash;
  if (proxy) {
    const admin = await artifact("ProxyAdmin");
    const request = { account, address: proxy.proxyAdmin, abi: admin.abi, functionName: "upgradeAndCall", args: [proxy.proxy, next, "0x"] };
    await client.simulateContract(request);
    hash = await wallet.writeContract(request);
  } else {
    const b = await artifact("UpgradeableBeacon");
    const request = { account, address: beacon.beacon, abi: b.abi, functionName: "upgradeTo", args: [next] };
    await client.simulateContract(request);
    hash = await wallet.writeContract(request);
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Upgrade transaction failed");
  (proxy ?? beacon).implementation = next;
  manifest.upgradeHistory = [...(manifest.upgradeHistory ?? []), { target, from: current, to: next, logic: contract, transactionHash: hash, runtimeCodeHash: keccak256(await client.getBytecode({ address: next })), at: new Date().toISOString() }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ upgraded: target, from: current, to: next, transactionHash: hash }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
