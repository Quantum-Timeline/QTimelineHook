// Deploys the Anthropic IPO pricing system on Robinhood Chain Mainnet (4663).
// It is a separate deployment from Core PCE: its own registry, factory, adapter, verifier, key registry, bot keys and manifest.
// Every contract is upgradeable: singletons sit behind TransparentUpgradeableProxy, per-market vaults, claim tokens and hooks behind beacons.
// The deployer owns every ProxyAdmin and beacon, so it can replace logic (including logic that holds collateral); ownership can be moved or renounced.
// Preflight is the default; --broadcast sends transactions. Core PCE tooling and artifacts are untouched.
import { sign as signMlDsa, verify as verifyMlDsa } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectMainnetMlDsaKey } from "./lib/mainnet-ml-dsa-key-validation.mjs";
import { deriveMainnetMlDsaKeyPair } from "./lib/mainnet-ml-dsa-keypair.mjs";
import { MAINNET_CHAIN_ID, MAINNET_CORE, mainnetRpcUrl, requireMainnetBroadcast, validateMainnetSigners } from "./lib/mainnet-release-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, getAddress, getCreate2Address, hashTypedData,
  http, keccak256, toBytes, toHex,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const envPath = resolve(root, "contracts/.env");
const secretDir = resolve(root, "contracts/.secrets");
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || "deployments/robinhood-mainnet-ipo.json");
// Schedule parameters are immutable once deployed, so they are explicit and recorded in the manifest.
const scheduleParams = {
  releaseDelay: BigInt(process.env.QT_IPO_RELEASE_DELAY_SECONDS ?? 64_800), // swap cutoff to earliest report: 18h (pricing evening to the 424B4 next morning)
  resolutionWindow: BigInt(process.env.QT_IPO_RESOLUTION_WINDOW_SECONDS ?? 172_800), // earliest report to cancellation: 48h
  minimumTradingWindow: BigInt(process.env.QT_IPO_MIN_TRADING_SECONDS ?? 43_200), // activation to cutoff: 12h
};
// Signer material: the deployer identity is shared with the PCE system, the bot keys are separate.
const keyFile = (role, suffix) => (role === "deployer" ? `mainnet-deployer-mldsa44${suffix}` : `mainnet-ipo-bot-mldsa44${suffix}`);
const helperHash = "0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b";
const registerTypes = { RegisterKey: [
  { name: "signer", type: "address" }, { name: "pkBlob", type: "address" }, { name: "codeHash", type: "bytes32" }, { name: "expiry", type: "uint64" },
] };

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

async function artifact(name) {
  try {
    return JSON.parse(await readFile(resolve(root, `contracts/out/${name}.sol/${name}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing Foundry artifact for ${name}; run pnpm contracts:build before Mainnet deployment`);
    throw error;
  }
}

function validateDeploymentArtifact(name, item) {
  const creation = item.bytecode?.object?.replace(/^0x/i, "");
  const runtime = item.deployedBytecode?.object?.replace(/^0x/i, "");
  if (!creation || creation.includes("__") || !/^(?:[0-9a-f]{2})+$/i.test(creation)) throw new Error(`${name} creation bytecode is unlinked, empty, or malformed`);
  if (!runtime || runtime.includes("__") || !/^(?:[0-9a-f]{2})+$/i.test(runtime)) throw new Error(`${name} runtime bytecode is unlinked, empty, or malformed`);
  const runtimeBytes = runtime.length / 2;
  if (runtimeBytes > 24_576) throw new Error(`${name} runtime exceeds EIP-170 (${runtimeBytes} bytes)`);
  if (creation.length / 2 > 49_152) throw new Error(`${name} creation bytecode exceeds the EIP-3860 initcode limit`);
  return item;
}

async function loadManifest(deployer, resolver) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.chainId !== MAINNET_CHAIN_ID || getAddress(manifest.deployer) !== deployer || getAddress(manifest.resolverSigner) !== resolver) {
      throw new Error("Existing Mainnet manifest belongs to another chain or signer pair; refusing to reuse it");
    }
    if (manifest.system !== "anthropic-ipo-pricing") throw new Error("Existing manifest is not the Anthropic IPO pricing deployment; refusing to reuse it");
    manifest.deployments ??= {};
    manifest.wiring ??= {};
    return manifest;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { schemaVersion: 1, system: "anthropic-ipo-pricing", chainId: MAINNET_CHAIN_ID, network: "Robinhood Chain", deployer, resolverSigner: resolver, deployments: {}, wiring: {} };
  }
}

async function saveManifest(manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function requireCode(client, address, name) {
  const code = await client.getBytecode({ address });
  if (!code || code === "0x") throw new Error(`${name} has no Mainnet bytecode at ${address}`);
  return code;
}

async function checkKeys({ deployer, resolver, pythonPath }) {
  validateMainnetSigners({ chainId: MAINNET_CHAIN_ID, deployer: deployer.address, resolver: resolver.address });
  const keys = {};
  for (const role of ["deployer", "bot"]) {
    const seed = await readFile(resolve(secretDir, keyFile(role, ".seed")));
    const keyPair = deriveMainnetMlDsaKeyPair(seed);
    const inspected = inspectMainnetMlDsaKey({ seed, publicKey: keyPair.publicKeyBytes, pythonPath });
    const blobHex = (await readFile(resolve(secretDir, keyFile(role, "-blob.hex")), "utf8")).trim();
    if (blobHex.toLowerCase() !== inspected.preparedBlob.toString("hex")) throw new Error(`${role} ML-DSA prepared blob does not match the validated seed`);
    keys[role] = { ...keyPair, ...inspected };
  }
  return keys;
}

async function checkMainnet({ client, deployer, resolver, pythonPath, requireFunding }) {
  const chainId = await client.getChainId();
  if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Refusing Mainnet operation on chain ID ${chainId}`);
  validateMainnetSigners({ chainId, deployer: deployer.address, resolver: resolver.address });
  const blockNumber = await client.getBlockNumber();
  const code = {};
  for (const [name, address] of Object.entries(MAINNET_CORE)) code[name] = await requireCode(client, getAddress(address), name);
  const tokenAbi = [
    { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  ];
  const [[usdgSymbol, usdgDecimals], [wethSymbol, wethDecimals], deployerBalance, keys] = await Promise.all([
    Promise.all([
      client.readContract({ address: getAddress(MAINNET_CORE.USDG), abi: tokenAbi, functionName: "symbol" }),
      client.readContract({ address: getAddress(MAINNET_CORE.USDG), abi: tokenAbi, functionName: "decimals" }),
    ]),
    Promise.all([
      client.readContract({ address: getAddress(MAINNET_CORE.WETH), abi: tokenAbi, functionName: "symbol" }),
      client.readContract({ address: getAddress(MAINNET_CORE.WETH), abi: tokenAbi, functionName: "decimals" }),
    ]),
    client.getBalance({ address: deployer.address }),
    checkKeys({ deployer, resolver, pythonPath }),
  ]);
  if (usdgSymbol !== "USDG" || usdgDecimals !== 6) throw new Error(`Official USDG metadata mismatch: ${usdgSymbol}/${usdgDecimals}`);
  if (wethSymbol !== "WETH" || wethDecimals !== 18) throw new Error(`Official WETH metadata mismatch: ${wethSymbol}/${wethDecimals}`);
  if (requireFunding && deployerBalance === 0n) throw new Error("Deployer has no Mainnet ETH for deployment gas");
  return { chainId, blockNumber, code, usdgSymbol, usdgDecimals, wethSymbol, wethDecimals, deployerBalance, keys };
}

async function deployContract({ name, artifactName = name, args = [], client, wallet, account, manifest }) {
  const previous = manifest.deployments[name];
  if (previous?.address) {
    const code = await requireCode(client, getAddress(previous.address), name);
    if (keccak256(code) !== previous.runtimeCodeHash) throw new Error(`${name} saved address has an unexpected runtime code hash`);
    return getAddress(previous.address);
  }
  const item = await artifact(artifactName);
  if (!item.bytecode?.object || item.bytecode.object.includes("__")) throw new Error(`${name} artifact is unlinked or empty`);
  validateDeploymentArtifact(artifactName, item);
  const hash = await wallet.deployContract({ account, abi: item.abi, bytecode: `0x${item.bytecode.object.replace(/^0x/i, "")}`, args });
  console.log(`${name} deployment tx: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
  const address = getAddress(receipt.contractAddress);
  const code = await requireCode(client, address, name);
  const runtimeCodeHash = keccak256(code);
  manifest.deployments[name] = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), runtimeCodeHash };
  await saveManifest(manifest);
  console.log(`${name}: ${address} (${receipt.gasUsed.toString()} gas)`);
  return address;
}

function runtimeInitCode(runtimeHex) {
  const clean = runtimeHex.replace(/^0x/i, "").replace(/\s/g, "");
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) throw new Error("Prepared runtime contains invalid hex");
  const length = clean.length / 2;
  if (length > 49_137) throw new Error("Prepared runtime exceeds EIP-3860 initcode limit");
  const encodedLength = length.toString(16).padStart(4, "0");
  return `0x61${encodedLength}61000f60003961${encodedLength}6000f3${clean}`;
}

async function deployRuntime({ name, runtimeHex, expectedHash, client, wallet, account, manifest }) {
  const previous = manifest.deployments[name];
  if (previous?.address) {
    const code = await requireCode(client, getAddress(previous.address), name);
    if (keccak256(code) !== expectedHash) throw new Error(`${name} saved address has an unexpected code hash`);
    return getAddress(previous.address);
  }
  const hash = await wallet.sendTransaction({ account, data: runtimeInitCode(runtimeHex) });
  console.log(`${name} deployment tx: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
  const address = getAddress(receipt.contractAddress);
  const code = await requireCode(client, address, name);
  const runtimeCodeHash = keccak256(code);
  if (runtimeCodeHash !== expectedHash) throw new Error(`${name} deployed code hash mismatch`);
  manifest.deployments[name] = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), runtimeCodeHash };
  await saveManifest(manifest);
  console.log(`${name}: ${address} (${receipt.gasUsed.toString()} gas)`);
  return address;
}

async function writeAndConfirm({ client, wallet, account, address, abi, functionName, args, label }) {
  const request = { account, address, abi, functionName, args };
  await client.simulateContract(request);
  const hash = await wallet.writeContract(request);
  console.log(`${label} tx: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  return { hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() };
}

async function registerKey({ role, signer, ecdsaAccount, key, keyRegistry, verifier, client, wallet, deployer, manifest }) {
  const registryArtifact = await artifact("IpoPQKeyRegistry");
  const verifierArtifact = await artifact("MLDSA44Verifier");
  const blobKey = `${role}PKBlob`;
  const previousBlob = await client.readContract({ address: keyRegistry, abi: registryArtifact.abi, functionName: "publicKeyBlob", args: [signer] });
  let blobAddress;
  if (previousBlob !== "0x0000000000000000000000000000000000000000") {
    blobAddress = getAddress(previousBlob);
    if (manifest.deployments[blobKey]?.address && getAddress(manifest.deployments[blobKey].address) !== blobAddress) throw new Error(`${role} signer is already bound to a different key blob`);
    const existingBlobCode = await requireCode(client, blobAddress, `${role} prepared key blob`);
    if (keccak256(existingBlobCode) !== key.preparedBlobCodeHash) throw new Error(`${role} signer is registered to a different prepared ML-DSA key`);
  } else {
    const blobHex = (await readFile(resolve(secretDir, keyFile(role, "-blob.hex")), "utf8")).trim();
    blobAddress = await deployRuntime({ name: blobKey, runtimeHex: blobHex, expectedHash: key.preparedBlobCodeHash, client, wallet, account: deployer, manifest });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const domain = { name: "QTimeline Key Registry", version: "1", chainId: MAINNET_CHAIN_ID, verifyingContract: keyRegistry };
    const message = { signer, pkBlob: blobAddress, codeHash: key.preparedBlobCodeHash, expiry };
    const digest = hashTypedData({ domain, types: registerTypes, primaryType: "RegisterKey", message });
    const digestBytes = Buffer.from(digest.slice(2), "hex");
    const pqProof = signMlDsa(null, digestBytes, key.privateKey);
    if (!verifyMlDsa(null, digestBytes, key.publicKey, pqProof)) throw new Error(`${role} local ML-DSA proof-of-possession failed`);
    const validOnChain = await client.readContract({ address: verifier, abi: verifierArtifact.abi, functionName: "verify", args: [blobAddress, digest, `0x${pqProof.toString("hex")}`] });
    if (!validOnChain) throw new Error(`${role} proof was rejected by the deployed verifier`);
    const ecdsaProof = await ecdsaAccount.signTypedData({ domain, types: registerTypes, primaryType: "RegisterKey", message });
    const registration = await writeAndConfirm({
      client, wallet, account: deployer, address: keyRegistry, abi: registryArtifact.abi,
      functionName: "register", args: [signer, blobAddress, expiry, ecdsaProof, `0x${pqProof.toString("hex")}`], label: `PQKeyRegistry.register(${role})`,
    });
    manifest.wiring[`${role}KeyRegistered`] = registration;
    await saveManifest(manifest);
  }
  manifest.keyValidation ??= {};
  manifest.keyValidation[role] = {
    signer, pkBlob: blobAddress, keygenSeedBound: key.seedBound,
    publicKeyFingerprint: key.publicKeyFingerprint, preparedBlobCodeHash: key.preparedBlobCodeHash,
    nonDegeneracyFloorCount: key.nonDegeneracyFloorCount,
  };
  await saveManifest(manifest);
  return blobAddress;
}

async function runPreflight({ client, report, manifest }) {
  console.log(JSON.stringify({
    chainId: report.chainId,
    latestBlock: report.blockNumber.toString(),
    deployer: manifest.deployer,
    resolverSigner: manifest.resolverSigner,
    officialCore: Object.fromEntries(Object.entries(MAINNET_CORE).map(([name, address]) => [name, { address, codeBytes: (report.code[name].length - 2) / 2, codeHash: keccak256(report.code[name]) }])),
    assets: { USDG: `${report.usdgSymbol}/${report.usdgDecimals}`, WETH: `${report.wethSymbol}/${report.wethDecimals}` },
    signerKeys: Object.fromEntries(Object.entries(report.keys).map(([role, key]) => [role, { seedBound: key.seedBound, nonDegeneracyFloorCount: key.nonDegeneracyFloorCount, publicKeyFingerprint: key.publicKeyFingerprint, preparedBlobCodeHash: key.preparedBlobCodeHash }])),
    system: "anthropic-ipo-pricing",
    schedule: Object.fromEntries(Object.entries(scheduleParams).map(([k, v]) => [k, v.toString()])),
    balances: { deployer: formatEther(report.deployerBalance) },
    deployerGasReady: report.deployerBalance > 0n,
    noTransactionSent: true,
  }, null, 2));
}

async function main() {
  const shouldBroadcast = requireMainnetBroadcast(process.argv.slice(2));
  const env = parseEnv(await readFile(envPath, "utf8"));
  const rpcUrl = mainnetRpcUrl({ override: process.env.QT_MAINNET_RPC, configured: env.RH_MAINNET_RPC });
  if (!env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY)) throw new Error("Set a valid RH_MAINNET_DEPLOYER_PRIVATE_KEY in contracts/.env");
  const deployer = privateKeyToAccount(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY);
  if (!env.RH_MAINNET_DEPLOYER_ADDRESS || getAddress(env.RH_MAINNET_DEPLOYER_ADDRESS) !== getAddress(deployer.address)) throw new Error("RH_MAINNET_DEPLOYER_ADDRESS does not match the configured deployer key");
  const resolver = privateKeyToAccount((await readFile(resolve(secretDir, "mainnet-ipo-bot-ecdsa.hex"), "utf8")).trim());
  const pythonPath = process.env.QTIMELINE_MLDSA_PYTHON || resolve(secretDir, "pythonref-venv/Scripts/python.exe");
  const chain = defineChain({ id: MAINNET_CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
  const report = await checkMainnet({ client, deployer, resolver, pythonPath, requireFunding: shouldBroadcast });
  const manifest = await loadManifest(getAddress(deployer.address), getAddress(resolver.address));
  if (!shouldBroadcast) {
    await runPreflight({ client, report, manifest });
    console.log(`Read-only IPO preflight complete (schedule: release delay ${scheduleParams.releaseDelay}s, window ${scheduleParams.resolutionWindow}s, minimum trading ${scheduleParams.minimumTradingWindow}s). Add --broadcast only after funding gas. No transaction was signed or sent.`);
    if (report.deployerBalance === 0n) process.exitCode = 1;
    return;
  }

  console.log(`Broadcast enabled for Robinhood Mainnet ${MAINNET_CHAIN_ID}. Deployer ${getAddress(deployer.address)}; resolver ${getAddress(resolver.address)}; balance ${formatEther(report.deployerBalance)} ETH.`);
  const core = Object.fromEntries(Object.entries(MAINNET_CORE).map(([name, address]) => [name, getAddress(address)]));
  const helperPath = resolve(root, "contracts/lib/evm-ml-dsa-verifier/helpers/f1600_170.hex");
  const helperHex = (await readFile(helperPath, "utf8")).replace(/^0x/i, "").replace(/\s/g, "");
  if (keccak256(`0x${helperHex}`) !== helperHash) throw new Error("Pinned Keccak helper hash mismatch");
  const logicNames = ["IpoMarketRegistry", "IpoPQKeyRegistry", "IpoMarketFactory", "IpoResolutionAdapter", "IpoTimelineRouter", "IpoConditionalVault", "IpoOutcomeToken"];
  for (const name of ["MLDSA44Verifier", ...logicNames, "IpoTimelineHook", "IpoHookDeployer", "TransparentUpgradeableProxy", "UpgradeableBeacon"]) {
    validateDeploymentArtifact(name, await artifact(name));
  }
  const helper = await deployRuntime({ name: "F1600Helper", runtimeHex: helperHex, expectedHash: helperHash, client, wallet, account: deployer, manifest });
  const verifier = await deployContract({ name: "MLDSA44Verifier", args: [helper], client, wallet, account: deployer, manifest });

  // Logic contracts (implementations). Their own initializers are locked; only proxies can be initialized.
  const impl = {};
  for (const name of logicNames) impl[name] = await deployContract({ name: `${name}Impl`, artifactName: name, client, wallet, account: deployer, manifest });

  // Uniswap v4 reads permission flags from the hook address, so the hook logic is deployed through CREATE2 at a mined address.
  const hookDeployerArtifact = await artifact("IpoHookDeployer");
  const hookDeployer = await deployContract({ name: "IpoHookDeployer", args: [deployer.address], client, wallet, account: deployer, manifest });
  let hookImpl = manifest.deployments.IpoTimelineHookImpl?.address ? getAddress(manifest.deployments.IpoTimelineHookImpl.address) : undefined;
  if (!hookImpl) {
    const bytecodeHash = await client.readContract({ address: hookDeployer, abi: hookDeployerArtifact.abi, functionName: "implementationInitCodeHash", args: [core.PoolManager] });
    let salt;
    for (let i = 0n; i < 5_000_000n; i += 1n) {
      const candidate = toHex(i, { size: 32 });
      if ((BigInt(getCreate2Address({ from: hookDeployer, salt: candidate, bytecodeHash })) & 0x3fffn) === 0x2880n) { salt = candidate; break; }
    }
    if (!salt) throw new Error("Could not find a CREATE2 salt for the hook implementation");
    const sent = await writeAndConfirm({ client, wallet, account: deployer, address: hookDeployer, abi: hookDeployerArtifact.abi, functionName: "deployImplementation", args: [core.PoolManager, salt], label: "IpoHookDeployer.deployImplementation" });
    hookImpl = getAddress(await client.readContract({ address: hookDeployer, abi: hookDeployerArtifact.abi, functionName: "latestImplementation" }));
    manifest.deployments.IpoTimelineHookImpl = { address: hookImpl, transactionHash: sent.hash, blockNumber: sent.blockNumber, gasUsed: sent.gasUsed, runtimeCodeHash: keccak256(await requireCode(client, hookImpl, "IpoTimelineHookImpl")) };
    await saveManifest(manifest);
  }

  // Beacons: one upgrade of a beacon changes the logic of every market's vault, claim tokens or hook at once.
  const beaconOf = (name, implementation) => deployContract({ name, artifactName: "UpgradeableBeacon", args: [implementation, deployer.address], client, wallet, account: deployer, manifest });
  const tokenBeacon = await beaconOf("IpoOutcomeTokenBeacon", impl.IpoOutcomeToken);
  const vaultBeacon = await beaconOf("IpoConditionalVaultBeacon", impl.IpoConditionalVault);
  const hookBeacon = await beaconOf("IpoTimelineHookBeacon", hookImpl);

  // Singletons behind transparent proxies. Each proxy deploys its own ProxyAdmin owned by the deployer.
  const proxyOf = async (key, logic, logicName, args) => {
    const data = encodeFunctionData({ abi: (await artifact(logicName)).abi, functionName: "initialize", args });
    return deployContract({ name: key, artifactName: "TransparentUpgradeableProxy", args: [logic, deployer.address, data], client, wallet, account: deployer, manifest });
  };
  const registry = await proxyOf("IpoMarketRegistry", impl.IpoMarketRegistry, "IpoMarketRegistry", [deployer.address, scheduleParams.releaseDelay, scheduleParams.resolutionWindow, scheduleParams.minimumTradingWindow]);
  const keyRegistry = await proxyOf("PQKeyRegistry", impl.IpoPQKeyRegistry, "IpoPQKeyRegistry", [deployer.address, verifier]);
  const factory = await proxyOf("IpoMarketFactory", impl.IpoMarketFactory, "IpoMarketFactory", [deployer.address, core.USDG, core.PoolManager, registry, keyRegistry, verifier, tokenBeacon, vaultBeacon]);
  const adapter = await proxyOf("IpoResolutionAdapter", impl.IpoResolutionAdapter, "IpoResolutionAdapter", [registry, keyRegistry, verifier, resolver.address]);
  const router = await proxyOf("TimelineRouter", impl.IpoTimelineRouter, "IpoTimelineRouter", [core.PoolManager, registry]);

  manifest.addresses = {
    ...core, F1600Helper: helper, MLDSA44Verifier: verifier, IpoMarketRegistry: registry, PQKeyRegistry: keyRegistry, IpoMarketFactory: factory,
    IpoResolutionAdapter: adapter, IpoHookDeployer: hookDeployer, TimelineRouter: router,
  };
  manifest.implementations = { ...impl, IpoTimelineHook: hookImpl };
  manifest.beacons = { outcomeToken: tokenBeacon, vault: vaultBeacon, hook: hookBeacon };
  manifest.resolverSigner = getAddress(resolver.address);
  manifest.schedule = { releaseDelaySeconds: scheduleParams.releaseDelay.toString(), resolutionWindowSeconds: scheduleParams.resolutionWindow.toString(), minimumTradingWindowSeconds: scheduleParams.minimumTradingWindow.toString() };
  await saveManifest(manifest);
  const deployerKey = report.keys.deployer;
  const resolverKey = report.keys.bot;
  await registerKey({ role: "deployer", signer: deployer.address, ecdsaAccount: deployer, key: deployerKey, keyRegistry, verifier, client, wallet, deployer, manifest });
  await registerKey({ role: "bot", signer: resolver.address, ecdsaAccount: resolver, key: resolverKey, keyRegistry, verifier, client, wallet, deployer, manifest });

  const keyRegistryArtifact = await artifact("IpoPQKeyRegistry");
  const keysSealed = await client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "isSealed" });
  if (!keysSealed) {
    manifest.wiring.pqKeyRegistrySealed = await writeAndConfirm({ client, wallet, account: deployer, address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "seal", args: [], label: "IpoPQKeyRegistry.seal" });
    await saveManifest(manifest);
  }

  const factoryArtifact = await artifact("IpoMarketFactory");
  const configuredFactory = await client.readContract({ address: hookDeployer, abi: hookDeployerArtifact.abi, functionName: "factory" });
  if (configuredFactory === "0x0000000000000000000000000000000000000000") {
    manifest.wiring.hookDeployerConfigured = await writeAndConfirm({ client, wallet, account: deployer, address: hookDeployer, abi: hookDeployerArtifact.abi, functionName: "configure", args: [factory, hookBeacon], label: "IpoHookDeployer.configure" });
    await saveManifest(manifest);
  } else if (getAddress(configuredFactory) !== factory) throw new Error("The hook deployer is already configured for a different factory");
  const currentHookDeployer = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "hookDeployer" });
  if (currentHookDeployer === "0x0000000000000000000000000000000000000000") {
    manifest.wiring.factoryHookDeployerSet = await writeAndConfirm({ client, wallet, account: deployer, address: factory, abi: factoryArtifact.abi, functionName: "setHookDeployer", args: [hookDeployer], label: "IpoMarketFactory.setHookDeployer" });
    await saveManifest(manifest);
  } else if (getAddress(currentHookDeployer) !== hookDeployer) throw new Error("Mainnet factory hook deployer is already set to an unexpected address");

  const registryArtifact = await artifact("IpoMarketRegistry");
  const isSealed = await client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "isSealed" });
  if (!isSealed) {
    manifest.wiring.registryWiredAndSealed = await writeAndConfirm({ client, wallet, account: deployer, address: registry, abi: registryArtifact.abi, functionName: "wireAndSeal", args: [factory, adapter], label: "IpoMarketRegistry.wireAndSeal" });
    await saveManifest(manifest);
  }

  const [registryFactory, registryResolver, registryIsSealed, keyRegistryIsSealed, registeredCount, registeredDeployerBlob, registeredResolverBlob, configuredHookDeployer] = await Promise.all([
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "factory" }),
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "resolver" }),
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "isSealed" }),
    client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "isSealed" }),
    client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "registeredCount" }),
    client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "publicKeyBlob", args: [deployer.address] }),
    client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "publicKeyBlob", args: [resolver.address] }),
    client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "hookDeployer" }),
  ]);
  if (!registryIsSealed || getAddress(registryFactory) !== factory || getAddress(registryResolver) !== adapter) throw new Error("Mainnet registry wiring readback did not match the release manifest");
  if (!keyRegistryIsSealed || registeredCount < 2n) throw new Error("Mainnet PQ key registry is not sealed with both signers registered");
  if (getAddress(registeredDeployerBlob) !== getAddress(manifest.deployments.deployerPKBlob.address)
      || getAddress(registeredResolverBlob) !== getAddress(manifest.deployments.botPKBlob.address)) throw new Error("Mainnet PQ signer-to-key bindings do not match the release manifest");
  if (getAddress(configuredHookDeployer) !== hookDeployer) throw new Error("Mainnet factory hook deployer readback did not match");
  const [onchainDelay, onchainWindow, onchainMinimum, factoryDelay, factoryWindow] = await Promise.all([
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "releaseDelay" }),
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "resolutionWindow" }),
    client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "minimumTradingWindow" }),
    client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "releaseDelay" }),
    client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "resolutionWindow" }),
  ]);
  if (BigInt(onchainDelay) !== scheduleParams.releaseDelay || BigInt(onchainWindow) !== scheduleParams.resolutionWindow || BigInt(onchainMinimum) !== scheduleParams.minimumTradingWindow
      || BigInt(factoryDelay) !== scheduleParams.releaseDelay || BigInt(factoryWindow) !== scheduleParams.resolutionWindow) throw new Error("IPO schedule readback did not match the intended parameters");

  // Upgrade-control readback: who can change what, recorded in the manifest for anyone to audit.
  const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
  const slotAddress = async (address, slot) => getAddress(`0x${(await client.getStorageAt({ address, slot })).slice(-40)}`);
  const proxyAdminArtifact = await artifact("ProxyAdmin");
  const beaconArtifact = await artifact("UpgradeableBeacon");
  const upgradeControl = { proxies: {}, beacons: {} };
  for (const [key, proxyAddress, logic] of [["IpoMarketRegistry", registry, impl.IpoMarketRegistry], ["PQKeyRegistry", keyRegistry, impl.IpoPQKeyRegistry], ["IpoMarketFactory", factory, impl.IpoMarketFactory], ["IpoResolutionAdapter", adapter, impl.IpoResolutionAdapter], ["TimelineRouter", router, impl.IpoTimelineRouter]]) {
    if (await slotAddress(proxyAddress, ERC1967_IMPLEMENTATION_SLOT) !== getAddress(logic)) throw new Error(`${key} proxy does not point at its recorded implementation`);
    const admin = await slotAddress(proxyAddress, ERC1967_ADMIN_SLOT);
    const owner = getAddress(await client.readContract({ address: admin, abi: proxyAdminArtifact.abi, functionName: "owner" }));
    if (owner !== getAddress(deployer.address)) throw new Error(`${key} proxy admin is not owned by the deployer`);
    upgradeControl.proxies[key] = { proxy: proxyAddress, implementation: getAddress(logic), proxyAdmin: admin, owner };
  }
  for (const [key, beacon, logic] of [["outcomeToken", tokenBeacon, impl.IpoOutcomeToken], ["vault", vaultBeacon, impl.IpoConditionalVault], ["hook", hookBeacon, hookImpl]]) {
    const [beaconImpl, owner] = await Promise.all([
      client.readContract({ address: beacon, abi: beaconArtifact.abi, functionName: "implementation" }),
      client.readContract({ address: beacon, abi: beaconArtifact.abi, functionName: "owner" }),
    ]);
    if (getAddress(beaconImpl) !== getAddress(logic) || getAddress(owner) !== getAddress(deployer.address)) throw new Error(`${key} beacon readback did not match`);
    upgradeControl.beacons[key] = { beacon, implementation: getAddress(logic), owner: getAddress(owner) };
  }
  manifest.upgradeControl = upgradeControl;

  for (const [name, address] of Object.entries(manifest.addresses)) {
    const code = await requireCode(client, address, name);
    const recordedHash = manifest.deployments[name]?.runtimeCodeHash;
    if (recordedHash && keccak256(code) !== recordedHash) throw new Error(`${name} runtime code changed after deployment`);
    manifest.deployments[name] ??= { address, runtimeCodeHash: keccak256(code) };
  }
  manifest.deployedAndSealed = true;
  manifest.deploymentBlock = (await client.getBlockNumber()).toString();
  manifest.wiring.verified = true;
  await saveManifest(manifest);
  console.log(JSON.stringify({ chainId: MAINNET_CHAIN_ID, manifest: manifestPath, addresses: manifest.addresses, upgradeableBy: getAddress(deployer.address), deployedAndSealed: true, wiringReadbackVerified: true, marketCreated: false, note: "IPO contracts are deployed behind proxies and beacons and wired. Market creation and liquidity seeding remain separate release transactions." }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(process.env.QT_DEBUG_STACK === "1" && error instanceof Error ? error.stack : error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
