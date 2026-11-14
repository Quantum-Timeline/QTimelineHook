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
  createPublicClient, createWalletClient, defineChain, formatEther, getAddress, hashTypedData,
  http, keccak256, toBytes,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const envPath = resolve(root, "contracts/.env");
const secretDir = resolve(root, "contracts/.secrets");
const manifestPath = resolve(root, process.env.QTIMELINE_MAINNET_MANIFEST || "deployments/robinhood-mainnet.json");
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
    manifest.deployments ??= {};
    manifest.wiring ??= {};
    return manifest;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { schemaVersion: 1, chainId: MAINNET_CHAIN_ID, network: "Robinhood Chain", deployer, resolverSigner: resolver, deployments: {}, wiring: {} };
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
    const seed = await readFile(resolve(secretDir, `mainnet-${role}-mldsa44.seed`));
    const keyPair = deriveMainnetMlDsaKeyPair(seed);
    const inspected = inspectMainnetMlDsaKey({ seed, publicKey: keyPair.publicKeyBytes, pythonPath });
    const blobHex = (await readFile(resolve(secretDir, `mainnet-${role}-mldsa44-blob.hex`), "utf8")).trim();
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

async function deployContract({ name, args = [], client, wallet, account, manifest }) {
  const previous = manifest.deployments[name];
  if (previous?.address) {
    const code = await requireCode(client, getAddress(previous.address), name);
    if (keccak256(code) !== previous.runtimeCodeHash) throw new Error(`${name} saved address has an unexpected runtime code hash`);
    return getAddress(previous.address);
  }
  const item = await artifact(name);
  if (!item.bytecode?.object || item.bytecode.object.includes("__")) throw new Error(`${name} artifact is unlinked or empty`);
  validateDeploymentArtifact(name, item);
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
  const registryArtifact = await artifact("PQKeyRegistry");
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
    const blobHex = (await readFile(resolve(secretDir, `mainnet-${role === "bot" ? "bot" : "deployer"}-mldsa44-blob.hex`), "utf8")).trim();
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
  const resolver = privateKeyToAccount((await readFile(resolve(secretDir, "mainnet-bot-ecdsa.hex"), "utf8")).trim());
  const pythonPath = process.env.QTIMELINE_MLDSA_PYTHON || resolve(secretDir, "pythonref-venv/Scripts/python.exe");
  const chain = defineChain({ id: MAINNET_CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
  const report = await checkMainnet({ client, deployer, resolver, pythonPath, requireFunding: shouldBroadcast });
  const manifest = await loadManifest(getAddress(deployer.address), getAddress(resolver.address));
  if (!shouldBroadcast) {
    await runPreflight({ client, report, manifest });
    console.log("Read-only Mainnet preflight complete. Add --broadcast only after funding gas and completing the release review. No transaction was signed or sent.");
    if (report.deployerBalance === 0n) process.exitCode = 1;
    return;
  }

  console.log(`Broadcast enabled for Robinhood Mainnet ${MAINNET_CHAIN_ID}. Deployer ${getAddress(deployer.address)}; resolver ${getAddress(resolver.address)}; balance ${formatEther(report.deployerBalance)} ETH.`);
  const core = Object.fromEntries(Object.entries(MAINNET_CORE).map(([name, address]) => [name, getAddress(address)]));
  const helperPath = resolve(root, "contracts/lib/evm-ml-dsa-verifier/helpers/f1600_170.hex");
  const helperHex = (await readFile(helperPath, "utf8")).replace(/^0x/i, "").replace(/\s/g, "");
  if (keccak256(`0x${helperHex}`) !== helperHash) throw new Error("Pinned Keccak helper hash mismatch");
  for (const name of ["MLDSA44Verifier", "MarketRegistry", "PQKeyRegistry", "MarketFactory", "ResolutionAdapter", "TimelineHookDeployer", "TimelineRouter", "QTLVoting"]) {
    validateDeploymentArtifact(name, await artifact(name));
  }
  const helper = await deployRuntime({ name: "F1600Helper", runtimeHex: helperHex, expectedHash: helperHash, client, wallet, account: deployer, manifest });
  const verifier = await deployContract({ name: "MLDSA44Verifier", args: [helper], client, wallet, account: deployer, manifest });
  const registry = await deployContract({ name: "MarketRegistry", args: [deployer.address, false], client, wallet, account: deployer, manifest });
  const keyRegistry = await deployContract({ name: "PQKeyRegistry", args: [deployer.address, verifier], client, wallet, account: deployer, manifest });
  const factory = await deployContract({ name: "MarketFactory", args: [deployer.address, core.USDG, core.PoolManager, registry, keyRegistry, verifier, false], client, wallet, account: deployer, manifest });
  const adapter = await deployContract({ name: "ResolutionAdapter", args: [registry, keyRegistry, verifier, resolver.address], client, wallet, account: deployer, manifest });
  const hookDeployer = await deployContract({ name: "TimelineHookDeployer", args: [factory], client, wallet, account: deployer, manifest });
  const router = await deployContract({ name: "TimelineRouter", args: [core.PoolManager, registry], client, wallet, account: deployer, manifest });
  const voting = await deployContract({ name: "QTLVoting", args: [deployer.address], client, wallet, account: deployer, manifest });

  manifest.addresses = { ...core, F1600Helper: helper, MLDSA44Verifier: verifier, MarketRegistry: registry, PQKeyRegistry: keyRegistry, MarketFactory: factory, ResolutionAdapter: adapter, TimelineHookDeployer: hookDeployer, TimelineRouter: router, QTLVoting: voting };
  manifest.resolverSigner = getAddress(resolver.address);
  manifest.shortTestnetMode = false;
  await saveManifest(manifest);
  const deployerKey = report.keys.deployer;
  const resolverKey = report.keys.bot;
  await registerKey({ role: "deployer", signer: deployer.address, ecdsaAccount: deployer, key: deployerKey, keyRegistry, verifier, client, wallet, deployer, manifest });
  await registerKey({ role: "bot", signer: resolver.address, ecdsaAccount: resolver, key: resolverKey, keyRegistry, verifier, client, wallet, deployer, manifest });

  const keyRegistryArtifact = await artifact("PQKeyRegistry");
  const keysSealed = await client.readContract({ address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "isSealed" });
  if (!keysSealed) {
    manifest.wiring.pqKeyRegistrySealed = await writeAndConfirm({ client, wallet, account: deployer, address: keyRegistry, abi: keyRegistryArtifact.abi, functionName: "seal", args: [], label: "PQKeyRegistry.seal" });
    await saveManifest(manifest);
  }

  const factoryArtifact = await artifact("MarketFactory");
  const currentHookDeployer = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "hookDeployer" });
  if (currentHookDeployer === "0x0000000000000000000000000000000000000000") {
    manifest.wiring.factoryHookDeployerSet = await writeAndConfirm({ client, wallet, account: deployer, address: factory, abi: factoryArtifact.abi, functionName: "setHookDeployer", args: [hookDeployer], label: "MarketFactory.setHookDeployer" });
    await saveManifest(manifest);
  } else if (getAddress(currentHookDeployer) !== hookDeployer) throw new Error("Mainnet factory hook deployer is already set to an unexpected address");

  const registryArtifact = await artifact("MarketRegistry");
  const isSealed = await client.readContract({ address: registry, abi: registryArtifact.abi, functionName: "isSealed" });
  if (!isSealed) {
    manifest.wiring.registryWiredAndSealed = await writeAndConfirm({ client, wallet, account: deployer, address: registry, abi: registryArtifact.abi, functionName: "wireAndSeal", args: [factory, adapter], label: "MarketRegistry.wireAndSeal" });
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
  console.log(JSON.stringify({ chainId: MAINNET_CHAIN_ID, manifest: manifestPath, addresses: manifest.addresses, deployedAndSealed: true, wiringReadbackVerified: true, marketCreated: false, note: "Contracts are deployed and wired only. Mainnet market creation and liquidity seeding remain separate release transactions." }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(process.env.QT_DEBUG_STACK === "1" && error instanceof Error ? error.stack : error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
