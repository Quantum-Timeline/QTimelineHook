import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, "contracts/.env");
const expectedChainId = 4663;
const addresses = {
  PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
};
const erc20Metadata = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

function requireValue(env, key) {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key} in contracts/.env`);
  return value;
}

try {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const rpcUrl = requireValue(env, "RH_MAINNET_RPC");
  const rawAddress = requireValue(env, "RH_MAINNET_DEPLOYER_ADDRESS");
  const privateKey = requireValue(env, "RH_MAINNET_DEPLOYER_PRIVATE_KEY");
  if (!isAddress(rawAddress) || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("Invalid deployer address or private-key format");
  }

  const deployerAddress = getAddress(rawAddress);
  const derivedAddress = privateKeyToAccount(privateKey).address;
  const addressMatches = getAddress(derivedAddress) === deployerAddress;
  console.log(`Deployer key format: valid`);
  console.log(`Deployer address matches key: ${addressMatches ? "yes" : "NO"}`);
  if (!addressMatches) process.exitCode = 1;

  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  console.log(`RPC chain ID: ${chainId} ${chainId === expectedChainId ? "(expected)" : "(MISMATCH)"}`);
  console.log(`Latest block: ${blockNumber}`);
  if (chainId !== expectedChainId) process.exitCode = 1;

  for (const [name, address] of Object.entries(addresses)) {
    const code = await client.getBytecode({ address });
    const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    console.log(`${name}: ${bytes > 0 ? `${bytes} bytes of code` : "NO CODE"}`);
    if (bytes === 0) process.exitCode = 1;
  }

  const [symbol, decimals, balance] = await Promise.all([
    client.readContract({ address: addresses.USDG, abi: erc20Metadata, functionName: "symbol" }),
    client.readContract({ address: addresses.USDG, abi: erc20Metadata, functionName: "decimals" }),
    client.getBalance({ address: deployerAddress }),
  ]);
  console.log(`USDG metadata: ${symbol}, ${decimals} decimals ${symbol === "USDG" && decimals === 6 ? "(expected)" : "(MISMATCH)"}`);
  console.log(`Deployer native balance: ${formatEther(balance)} ETH`);
  if (symbol !== "USDG" || decimals !== 6) process.exitCode = 1;
  if (balance === 0n) {
    console.log("Deployment funding: BLOCKED (deployer has no gas funds)");
    process.exitCode = 1;
  }

  console.log("This legacy script is retained for compatibility. Use `pnpm deploy:mainnet:preflight` for the current seed-bound key, resolver balance, and release checks.");
  console.log("Read-only preflight complete. No transaction was signed or sent.");
} catch (error) {
  console.error(`Preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
