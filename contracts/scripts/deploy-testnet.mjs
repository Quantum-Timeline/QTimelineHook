import { readFile, mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as signMldsa, verify as verifyMldsa } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/package.json"));
const {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  formatEther,
  getAddress,
  getCreate2Address,
  hashTypedData,
  isAddress,
  keccak256,
  toBytes,
  toHex,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(root, "contracts/.env");
const shortTestnet = process.argv.includes("--short-testnet");
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || (shortTestnet ? "deployments/robinhood-testnet-short.json" : "deployments/robinhood-testnet-v2.json"));
const chainIdExpected = 46630;
const officialRpc = "https://rpc.testnet.chain.robinhood.com";
const core = {
  PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
};
const helperHash = "0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b";
const registerTypes = {
  RegisterKey: [
    { name: "signer", type: "address" },
    { name: "pkBlob", type: "address" },
    { name: "codeHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
};
const createMarketTypes = {
  CreateMarket: [
    { name: "configHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "signatureExpiry", type: "uint64" },
  ],
};

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    if (at < 1) return [];
    const key = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    return [[key, value]];
  }));
}

function requestHttps(url, body, ip) {
  return new Promise((resolvePromise, reject) => {
    const req = https.request({
      hostname: ip,
      servername: url.hostname,
      port: Number(url.port || 443),
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      rejectUnauthorized: true,
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
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("RPC request timed out")));
    req.end(body);
  });
}

function makePinnedRpcTransport(rpcUrl) {
  const url = new URL(rpcUrl);
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let cachedIp;
  async function rpcRequest(method, params) {
    if (!cachedIp) {
      const ips = await resolver.resolve4(url.hostname);
      if (!ips.length) throw new Error("Testnet RPC hostname did not resolve through independent DNS");
      cachedIp = process.env.RH_TESTNET_RPC_IP || ips[0];
    }
    return requestHttps(url, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }), cachedIp);
  }
  return custom({ request: ({ method, params }) => rpcRequest(method, params) });
}

async function loadArtifact(name) {
  const artifactPath = resolve(root, `contracts/out/${name}.sol/${name}.json`);
  return JSON.parse(await readFile(artifactPath, "utf8"));
}

async function loadManifest(deployer) {
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    if (existing.chainId !== chainIdExpected || getAddress(existing.deployer) !== deployer) {
      throw new Error("Existing testnet manifest belongs to another chain or deployer; refusing to overwrite it");
    }
    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { chainId: chainIdExpected, network: "Robinhood Chain Testnet", deployer, deployments: {}, wiring: {} };
  }
}

async function saveManifest(manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function codeAt(publicClient, address) {
  const code = await publicClient.getBytecode({ address });
  return code && code !== "0x" ? code : undefined;
}

async function deployContract({ name, args = [], publicClient, walletClient, account, manifest }) {
  const previous = manifest.deployments[name];
  if (previous?.address) {
    const code = await codeAt(publicClient, getAddress(previous.address));
    if (!code) throw new Error(`${name} is in manifest but has no code; refusing an automatic duplicate deployment`);
    console.log(`${name}: reusing ${getAddress(previous.address)}`);
    return getAddress(previous.address);
  }

  const artifact = await loadArtifact(name);
  if (!artifact.bytecode?.object || artifact.bytecode.object.includes("__")) throw new Error(`${name} artifact has missing or unlinked bytecode`);
  const bytecode = artifact.bytecode.object.replace(/^0x/i, "");
  const runtimeObject = artifact.deployedBytecode?.object?.replace(/^0x/i, "");
  const runtimeBytes = runtimeObject ? runtimeObject.length / 2 : 0;
  if (runtimeBytes > 24_576) throw new Error(`${name} runtime exceeds the EIP-170 limit (${runtimeBytes} bytes)`);

  const hash = await walletClient.deployContract({
    account,
    abi: artifact.abi,
    bytecode: `0x${bytecode}`,
    args,
  });
  console.log(`${name} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment did not produce a successful contract receipt`);
  const address = getAddress(receipt.contractAddress);
  const code = await codeAt(publicClient, address);
  if (!code) throw new Error(`${name} receipt has no deployed bytecode`);
  manifest.deployments[name] = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeCodeHash: keccak256(code) };
  await saveManifest(manifest);
  console.log(`${name}: ${address} (${receipt.gasUsed.toString()} gas)`);
  return address;
}

async function deployHelper(publicClient, walletClient, account, manifest) {
  const previous = manifest.deployments.F1600Helper;
  if (previous?.address) {
    const code = await codeAt(publicClient, getAddress(previous.address));
    if (!code || keccak256(code) !== helperHash) throw new Error("Saved F1600 helper is absent or has the wrong code hash");
    console.log(`F1600Helper: reusing ${getAddress(previous.address)}`);
    return getAddress(previous.address);
  }

  const helperPath = resolve(root, "contracts/lib/evm-ml-dsa-verifier/helpers/f1600_170.hex");
  const runtime = (await readFile(helperPath, "utf8")).replace(/^0x/i, "").replace(/\s/g, "");
  if (!/^[0-9a-f]+$/i.test(runtime) || runtime.length % 2 !== 0 || keccak256(`0x${runtime}`) !== helperHash) {
    throw new Error("Pinned F1600 helper does not match its expected code hash");
  }
  const length = runtime.length / 2;
  const lengthHex = length.toString(16).padStart(4, "0");
  const initCode = `0x61${lengthHex}61000f60003961${lengthHex}6000f3${runtime}`;
  const hash = await walletClient.sendTransaction({ account, data: initCode });
  console.log(`F1600Helper tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("F1600 helper deployment failed");
  const address = getAddress(receipt.contractAddress);
  const code = await codeAt(publicClient, address);
  if (!code || keccak256(code) !== helperHash) throw new Error("F1600 helper deployed with an unexpected code hash");
  manifest.deployments.F1600Helper = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeCodeHash: keccak256(code) };
  await saveManifest(manifest);
  console.log(`F1600Helper: ${address} (${receipt.gasUsed.toString()} gas)`);
  return address;
}

function buildRuntimeInitCode(runtime) {
  const cleanRuntime = runtime.replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(cleanRuntime) || cleanRuntime.length % 2 !== 0) throw new Error("Runtime code is not valid hex");
  const length = cleanRuntime.length / 2;
  if (length > 49_137) throw new Error("Runtime exceeds the EIP-3860 initcode limit");
  const lengthHex = length.toString(16).padStart(4, "0");
  return `0x61${lengthHex}61000f60003961${lengthHex}6000f3${cleanRuntime}`;
}

async function deployRuntime(name, runtime, publicClient, walletClient, account, manifest, expectedHash) {
  const previous = manifest.deployments[name];
  if (previous?.address) {
    const code = await codeAt(publicClient, getAddress(previous.address));
    if (!code || (expectedHash && keccak256(code) !== expectedHash)) throw new Error(`${name} saved address has unexpected code`);
    return getAddress(previous.address);
  }
  const initCode = buildRuntimeInitCode(runtime);
  const hash = await walletClient.sendTransaction({ account, data: initCode });
  console.log(`${name} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
  const address = getAddress(receipt.contractAddress);
  const code = await codeAt(publicClient, address);
  if (!code || (expectedHash && keccak256(code) !== expectedHash)) throw new Error(`${name} deployed code failed verification`);
  manifest.deployments[name] = { address, transactionHash: hash, blockNumber: receipt.blockNumber.toString(), runtimeCodeHash: keccak256(code) };
  await saveManifest(manifest);
  console.log(`${name}: ${address} (${receipt.gasUsed.toString()} gas)`);
  return address;
}

function nonDegenerateFloor(publicKeyBytes) {
  if (publicKeyBytes.length !== 1312) throw new Error("ML-DSA-44 public key must be 1,312 bytes");
  const q = 8_380_417n;
  const gamma2 = BigInt((8_380_417 - 1) / 88);
  let aboveFloor = 0;
  for (let row = 0; row < 4; row += 1) {
    const chunk = publicKeyBytes.subarray(32 + row * 320, 32 + (row + 1) * 320);
    const bits = BigInt(`0x${Buffer.from(chunk).reverse().toString("hex")}`);
    for (let i = 0; i < 256; i += 1) {
      const value = (bits >> BigInt(10 * i)) & 1023n;
      const lifted = (value << 13n) % q;
      const centered = lifted > q / 2n ? lifted - q : lifted;
      if ((centered < 0n ? -centered : centered) > gamma2) aboveFloor += 1;
    }
  }
  if (aboveFloor < 512) throw new Error(`Generated testnet key failed ML-DSA non-degeneracy floor (${aboveFloor}/1024)`);
  return aboveFloor;
}

async function getTestnetPqKey(role) {
  const secretDir = resolve(root, "contracts/.secrets");
  await mkdir(secretDir, { recursive: true });
  const pemPath = resolve(secretDir, `testnet-${role}-mldsa44.pem`);
  let privateKey;
  try {
    privateKey = createPrivateKey(await readFile(pemPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot load local ${role} ML-DSA key`);
    const generated = generateKeyPairSync("ml-dsa-44");
    privateKey = generated.privateKey;
    await writeFile(pemPath, privateKey.export({ format: "pem", type: "pkcs8" }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = der.subarray(der.length - 1312);
  const aboveFloor = nonDegenerateFloor(publicKeyBytes);
  const prepared = spawnSync(process.env.PYTHON || "python", [resolve(root, "contracts/lib/evm-ml-dsa-verifier/prepare/prepare.py")], {
    input: publicKeyBytes.toString("hex"), encoding: "utf8", maxBuffer: 1_000_000,
  });
  if (prepared.status !== 0) throw new Error(`Pinned public-key preparation failed for testnet ${role} signer`);
  const blob = `0x${prepared.stdout.trim()}`;
  if (blob.length !== 2 + 20_545 * 2 || !blob.startsWith("0x00")) throw new Error("Prepared ML-DSA key blob has an invalid length or prefix");
  return { privateKey, publicKey, publicKeyBytes, blob, aboveFloor };
}

async function getTestnetBotEcdsaAccount() {
  const secretDir = resolve(root, "contracts/.secrets");
  await mkdir(secretDir, { recursive: true });
  const keyPath = resolve(secretDir, "testnet-bot-ecdsa.hex");
  try {
    return privateKeyToAccount((await readFile(keyPath, "utf8")).trim());
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot load the local testnet bot ECDSA key");
  }
  for (;;) {
    const key = `0x${randomBytes(32).toString("hex")}`;
    try {
      const account = privateKeyToAccount(key);
      await writeFile(keyPath, `${key}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return account;
    } catch { /* retry only if the random value is outside the secp256k1 scalar range */ }
  }
}

async function registerTestnetKey({ role, signer, ecdsaAccount, keyRegistry, verifier, publicClient, walletClient, account, manifest }) {
  const registryArtifact = await loadArtifact("PQKeyRegistry");
  const alreadyRegistered = await publicClient.readContract({ address: keyRegistry, abi: registryArtifact.abi, functionName: "publicKeyBlob", args: [signer] });
  if (alreadyRegistered !== "0x0000000000000000000000000000000000000000") {
    const saved = manifest.deployments[`${role}PKBlob`]?.address;
    if (saved && getAddress(saved) !== getAddress(alreadyRegistered)) throw new Error(`${role} signer is bound to an unexpected key blob`);
    manifest.testnetKeys ??= {};
    manifest.testnetKeys[role] = { signer, pkBlob: getAddress(alreadyRegistered), alreadyRegistered: true };
    await saveManifest(manifest);
    return getAddress(alreadyRegistered);
  }

  const key = await getTestnetPqKey(role);
  console.log(`${role} ML-DSA key: generated/loaded locally; non-degeneracy floor ${key.aboveFloor}/1024`);
  const blobAddress = await deployRuntime(`${role}PKBlob`, key.blob, publicClient, walletClient, account, manifest);
  const codeHash = keccak256(key.blob);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const domain = { name: "QTimeline Key Registry", version: "1", chainId: chainIdExpected, verifyingContract: keyRegistry };
  const message = { signer, pkBlob: blobAddress, codeHash, expiry };
  const digest = hashTypedData({ domain, types: registerTypes, primaryType: "RegisterKey", message });
  const digestBytes = Buffer.from(digest.slice(2), "hex");
  const pqProof = signMldsa(null, digestBytes, key.privateKey);
  if (!verifyMldsa(null, digestBytes, key.publicKey, pqProof)) throw new Error(`${role} local ML-DSA proof-of-possession did not verify`);
  const verifierArtifact = await loadArtifact("MLDSA44Verifier");
  const validOnChain = await publicClient.readContract({ address: verifier, abi: verifierArtifact.abi, functionName: "verify", args: [blobAddress, digest, `0x${pqProof.toString("hex")}`] });
  if (!validOnChain) throw new Error(`${role} ML-DSA proof was rejected by the deployed testnet verifier`);
  const ecdsaProof = await ecdsaAccount.signTypedData({ domain, types: registerTypes, primaryType: "RegisterKey", message });
  const hash = await walletClient.writeContract({
    account, address: keyRegistry, abi: registryArtifact.abi, functionName: "register",
    args: [signer, blobAddress, expiry, ecdsaProof, `0x${pqProof.toString("hex")}`],
  });
  console.log(`PQKeyRegistry.register(${role}) tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${role} PQ key registration failed`);
  manifest.testnetKeys ??= {};
  manifest.testnetKeys[role] = { signer, pkBlob: blobAddress, codeHash, publicKeyFingerprint: keccak256(key.publicKeyBytes), nonDegeneracyFloorCount: key.aboveFloor, transactionHash: hash, blockNumber: receipt.blockNumber.toString() };
  await saveManifest(manifest);
  console.log(`${role} signer key registered: ${signer} -> ${blobAddress}`);
  return blobAddress;
}

async function sealTestnetKeys({ keyRegistry, publicClient, walletClient, account, manifest }) {
  const artifact = await loadArtifact("PQKeyRegistry");
  const [count, sealed] = await Promise.all([
    publicClient.readContract({ address: keyRegistry, abi: artifact.abi, functionName: "registeredCount" }),
    publicClient.readContract({ address: keyRegistry, abi: artifact.abi, functionName: "isSealed" }),
  ]);
  if (count < 2n) throw new Error(`PQ key registry has only ${count} registered key(s); at least two are required`);
  if (!sealed) {
    const hash = await walletClient.writeContract({ account, address: keyRegistry, abi: artifact.abi, functionName: "seal" });
    console.log(`PQKeyRegistry.seal tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("PQ key registry sealing failed");
    manifest.wiring.pqKeyRegistrySealed = { transactionHash: hash, blockNumber: receipt.blockNumber.toString() };
  }
  manifest.pqKeyRegistrySealed = true;
  await saveManifest(manifest);
}

async function createSmokeMarket({ deployerKey, factory, registry, keyRegistry, hookDeployer, usdg, publicClient, walletClient, account, manifest }) {
  const factoryArtifact = await loadArtifact("MarketFactory");
  const registryArtifact = await loadArtifact("MarketRegistry");
  const hookArtifact = await loadArtifact("TimelineHookDeployer");
  const chainBlock = await publicClient.getBlock();
  const now = chainBlock.timestamp;
  const nonce = await publicClient.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "nonces", args: [account.address] });
  const opensAt = now + (shortTestnet ? 60n : 3600n);
  const cutoffAt = shortTestnet ? opensAt + 300n : now + 172500n;
  const releaseAt = cutoffAt + (shortTestnet ? 10n : 300n);
  const deadline = releaseAt + (shortTestnet ? 120n : 172800n);
  const signatureExpiry = now + (shortTestnet ? 30n : 1800n);
  const testnetPeriod = process.env.QTIMELINE_TESTNET_PERIOD || `qtimeline-testnet-smoke-${chainBlock.number}`;
  const periodId = keccak256(toBytes(testnetPeriod));
  const config = {
    opensAt, cutoffAt, releaseAt, deadline, periodId, thresholdBps: 30,
    ethCollateralCap: 100_000_000_000_000_000n,
    usdgCollateralCap: 500_000_000n,
    nonce, signatureExpiry,
  };
  const configHash = keccak256(encodeAbiParameters(
    [
      { type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "uint64" },
      { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }, { type: "int32" },
      { type: "uint256" }, { type: "uint256" },
    ],
    [BigInt(chainIdExpected), factory, opensAt, cutoffAt, releaseAt, deadline, periodId, 30, config.ethCollateralCap, config.usdgCollateralCap],
  ));
  const marketId = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [configHash, nonce]));
  let smoke = manifest.smokeMarket;
  if (!smoke) {
    const domain = { name: "QTimeline", version: "1", chainId: chainIdExpected, verifyingContract: factory };
    const message = { configHash, nonce, signatureExpiry };
    const digest = hashTypedData({ domain, types: createMarketTypes, primaryType: "CreateMarket", message });
    const digestBytes = Buffer.from(digest.slice(2), "hex");
    const pqSignature = signMldsa(null, digestBytes, deployerKey.privateKey);
    if (!verifyMldsa(null, digestBytes, deployerKey.publicKey, pqSignature)) throw new Error("Local testnet market ML-DSA signature did not verify");
    const validOnChain = await publicClient.readContract({
      address: manifest.addresses.MLDSA44Verifier,
      abi: (await loadArtifact("MLDSA44Verifier")).abi,
      functionName: "verify",
      args: [manifest.testnetKeys.deployer.pkBlob, digest, `0x${pqSignature.toString("hex")}`],
    });
    if (!validOnChain) throw new Error("Deployed verifier rejected the testnet market signature");
    const initCodeHash = await publicClient.readContract({
      address: hookDeployer, abi: hookArtifact.abi, functionName: "initCodeHash",
      args: [core.PoolManager, registry, marketId],
    });
    let salt;
    let predictedHook;
    for (let i = 0n; i < 1_000_000n; i += 1n) {
      const candidate = toHex(i, { size: 32 });
      const predicted = getCreate2Address({ from: hookDeployer, salt: candidate, bytecodeHash: initCodeHash });
      if ((BigInt(predicted) & 0x3fffn) === 0x2880n) {
        salt = candidate;
        predictedHook = predicted;
        break;
      }
    }
    if (!salt) throw new Error("Could not find a CREATE2 salt for TimelineHook permissions");
    const predictedOnChain = await publicClient.readContract({
      address: hookDeployer, abi: hookArtifact.abi, functionName: "predict",
      args: [core.PoolManager, registry, marketId, salt],
    });
    if (getAddress(predictedOnChain) !== getAddress(predictedHook)) throw new Error("Locally mined hook address does not match the on-chain prediction");
    const ecdsaSignature = await account.signTypedData({ domain, types: createMarketTypes, primaryType: "CreateMarket", message });
    const hash = await walletClient.writeContract({
      account, address: factory, abi: factoryArtifact.abi, functionName: "createMarket",
      args: [config, ecdsaSignature, `0x${pqSignature.toString("hex")}`, salt],
    });
    console.log(`MarketFactory.createMarket smoke tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("Testnet smoke market creation failed");
    smoke = { marketId, configHash, opensAt: opensAt.toString(), cutoffAt: cutoffAt.toString(), releaseAt: releaseAt.toString(), deadline: deadline.toString(), hook: predictedHook, createTransactionHash: hash, createBlockNumber: receipt.blockNumber.toString() };
    manifest.smokeMarket = smoke;
    await saveManifest(manifest);
  }

  const poolsInitialized = await publicClient.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "poolsInitialized", args: [smoke.marketId] });
  if (!poolsInitialized) {
    const q96 = 1n << 96n;
    const hash = await walletClient.writeContract({
      account, address: factory, abi: factoryArtifact.abi, functionName: "initializePools",
      args: [smoke.marketId, [q96, q96, q96]],
    });
    console.log(`MarketFactory.initializePools smoke tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("Testnet smoke pool initialization failed");
    smoke.poolsInitialized = true;
    smoke.initializeTransactionHash = hash;
    smoke.initializeBlockNumber = receipt.blockNumber.toString();
    await saveManifest(manifest);
  }
  const market = await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: "market", args: [smoke.marketId] });
  if (!market.vault || market.vault === "0x0000000000000000000000000000000000000000") throw new Error("Testnet smoke market is not registered on-chain");
  const marketStatuses = ["Draft", "Scheduled", "Open", "Awaiting result", "Final YES", "Final NO", "Cancelled", "Discarded"];
  smoke.vault = getAddress(market.vault);
  smoke.status = marketStatuses[Number(market.status)] ?? "Unknown";
  smoke.activated = Boolean(market.activated);
  if (!smoke.collateralRoundTrip) {
    if (smoke.activated || Number(market.status) !== 0) throw new Error("Cannot run Draft split/merge smoke checks after market activation");
    const vaultArtifact = await loadArtifact("ConditionalVault");
    const tokenArtifact = await loadArtifact("TestUSDG");
    const zero = "0x0000000000000000000000000000000000000000";
    const nativeAmount = 1_000_000_000_000_000n;
    const usdgAmount = 100_000_000n;
    const txs = {};
    const write = async (label, contract, abi, functionName, args, value) => {
      const hash = await walletClient.writeContract({ account, address: contract, abi, functionName, args, ...(value === undefined ? {} : { value }) });
      console.log(`${label} tx: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error(`${label} failed on testnet`);
      txs[label] = hash;
    };

    // Recover any partial smoke-run balance before repeating, then prove treasury split/merge on both assets.
    for (const asset of [zero, addressesOf(manifest).TestUSDG]) {
      const yes = await publicClient.readContract({ address: smoke.vault, abi: vaultArtifact.abi, functionName: "outcomeToken", args: [asset, true] });
      const no = await publicClient.readContract({ address: smoke.vault, abi: vaultArtifact.abi, functionName: "outcomeToken", args: [asset, false] });
      const [yesBalance, noBalance] = await Promise.all([
        publicClient.readContract({ address: yes, abi: tokenArtifact.abi, functionName: "balanceOf", args: [account.address] }),
        publicClient.readContract({ address: no, abi: tokenArtifact.abi, functionName: "balanceOf", args: [account.address] }),
      ]);
      const mergeAmount = yesBalance < noBalance ? yesBalance : noBalance;
      if (mergeAmount > 0n) await write(`recover ${asset === zero ? "ETH" : "USDG"} draft pair`, smoke.vault, vaultArtifact.abi, "merge", [asset, mergeAmount, account.address]);
    }

    await write("draft ETH split", smoke.vault, vaultArtifact.abi, "split", [zero, nativeAmount, account.address], nativeAmount);
    await write("draft ETH merge", smoke.vault, vaultArtifact.abi, "merge", [zero, nativeAmount, account.address]);
    await write("USDG approval", usdg, tokenArtifact.abi, "approve", [smoke.vault, usdgAmount]);
    await write("draft USDG split", smoke.vault, vaultArtifact.abi, "split", [usdg, usdgAmount, account.address]);
    await write("draft USDG merge", smoke.vault, vaultArtifact.abi, "merge", [usdg, usdgAmount, account.address]);
    const [ethLiability, usdgLiability] = await Promise.all([
      publicClient.readContract({ address: smoke.vault, abi: vaultArtifact.abi, functionName: "accountedCollateral", args: [zero] }),
      publicClient.readContract({ address: smoke.vault, abi: vaultArtifact.abi, functionName: "accountedCollateral", args: [usdg] }),
    ]);
    if (ethLiability !== 0n || usdgLiability !== 0n) throw new Error("Draft split/merge left collateral liabilities in the test vault");
    smoke.collateralRoundTrip = { nativeAmount: nativeAmount.toString(), usdgAmount: usdgAmount.toString(), accountedEth: "0", accountedUsdg: "0", transactions: txs };
  }
  manifest.smokeMarket = smoke;
  return smoke;
}

function addressesOf(manifest) {
  if (!manifest.addresses?.TestUSDG) throw new Error("USDG test token address is not in the testnet manifest");
  return manifest.addresses;
}

async function verifyTestnetStack({ manifest, publicClient, account }) {
  const addresses = manifest.addresses;
  for (const [name, address] of Object.entries(addresses)) {
    if (!(await codeAt(publicClient, address))) throw new Error(`Post-deploy verification failed: ${name} has no code`);
  }
  const [tokenAbi, factoryAbi, registryAbi, keysAbi, resolverAbi, hookAbi, routerAbi, votingAbi] = await Promise.all([
    loadArtifact("TestUSDG"), loadArtifact("MarketFactory"), loadArtifact("MarketRegistry"),
    loadArtifact("PQKeyRegistry"), loadArtifact("ResolutionAdapter"), loadArtifact("TimelineHookDeployer"),
    loadArtifact("TimelineRouter"), loadArtifact("QTLVoting"),
  ]).then((artifacts) => artifacts.map((artifact) => artifact.abi));
  const [symbol, decimals, factoryRegistry, factoryUsdg, factoryManager, factoryHookDeployer,
    registryFactory, registryResolver, registrySealed, keyCount, keyRegistrySealed,
    resolverSigner, hookFactory, routerManager, routerRegistry, votingDeployer, votingBound, votingToken,
    tokenBalance] = await Promise.all([
    publicClient.readContract({ address: addresses.TestUSDG, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: addresses.TestUSDG, abi: tokenAbi, functionName: "decimals" }),
    publicClient.readContract({ address: addresses.MarketFactory, abi: factoryAbi, functionName: "registry" }),
    publicClient.readContract({ address: addresses.MarketFactory, abi: factoryAbi, functionName: "usdg" }),
    publicClient.readContract({ address: addresses.MarketFactory, abi: factoryAbi, functionName: "poolManager" }),
    publicClient.readContract({ address: addresses.MarketFactory, abi: factoryAbi, functionName: "hookDeployer" }),
    publicClient.readContract({ address: addresses.MarketRegistry, abi: registryAbi, functionName: "factory" }),
    publicClient.readContract({ address: addresses.MarketRegistry, abi: registryAbi, functionName: "resolver" }),
    publicClient.readContract({ address: addresses.MarketRegistry, abi: registryAbi, functionName: "isSealed" }),
    publicClient.readContract({ address: addresses.PQKeyRegistry, abi: keysAbi, functionName: "registeredCount" }),
    publicClient.readContract({ address: addresses.PQKeyRegistry, abi: keysAbi, functionName: "isSealed" }),
    publicClient.readContract({ address: addresses.ResolutionAdapter, abi: resolverAbi, functionName: "authorizedSigner" }),
    publicClient.readContract({ address: addresses.TimelineHookDeployer, abi: hookAbi, functionName: "factory" }),
    publicClient.readContract({ address: addresses.TimelineRouter, abi: routerAbi, functionName: "poolManager" }),
    publicClient.readContract({ address: addresses.TimelineRouter, abi: routerAbi, functionName: "registry" }),
    publicClient.readContract({ address: addresses.QTLVoting, abi: votingAbi, functionName: "deployer" }),
    publicClient.readContract({ address: addresses.QTLVoting, abi: votingAbi, functionName: "tokenBound" }),
    publicClient.readContract({ address: addresses.QTLVoting, abi: votingAbi, functionName: "qtl" }),
    publicClient.readContract({ address: addresses.TestUSDG, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  const same = (left, right) => getAddress(left) === getAddress(right);
  const expectedVotingToken = manifest.testnetVoting?.token;
  const votingBindingMatches = expectedVotingToken
    ? votingBound && same(votingToken, expectedVotingToken)
    : !votingBound;
  if (symbol !== "USDG" || decimals !== 6 || !same(factoryRegistry, addresses.MarketRegistry) || !same(factoryUsdg, addresses.TestUSDG)
    || !same(factoryManager, addresses.PoolManager) || !same(factoryHookDeployer, addresses.TimelineHookDeployer)
    || !same(registryFactory, addresses.MarketFactory) || !same(registryResolver, addresses.ResolutionAdapter) || !registrySealed
    || keyCount !== 2n || !keyRegistrySealed || !same(resolverSigner, manifest.resolverSigner)
    || !same(hookFactory, addresses.MarketFactory) || !same(routerManager, addresses.PoolManager)
    || !same(routerRegistry, addresses.MarketRegistry) || !same(votingDeployer, account.address) || !votingBindingMatches
    || tokenBalance < 10_000_000_000n) {
    throw new Error("At least one QTimeline testnet configuration or read-back check did not match");
  }
  console.log("Verified: all manifest contracts have bytecode; v4 links, factory hook, sealed market registry, two registered/sealed ML-DSA keys, USDG metadata/faucet balance, and QTL voting token binding matches the testnet manifest.");
}

async function writeAndConfirm({ address, name, functionName, args, publicClient, walletClient, account, manifest, key }) {
  if (manifest.wiring[key]) return;
  const artifact = await loadArtifact(name);
  const hash = await walletClient.writeContract({ account, address, abi: artifact.abi, functionName, args });
  console.log(`${name}.${functionName} tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${name}.${functionName} failed`);
  manifest.wiring[key] = { transactionHash: hash, blockNumber: receipt.blockNumber.toString() };
  await saveManifest(manifest);
}

try {
  if (!process.argv.includes("--broadcast")) throw new Error("Pass --broadcast to deploy to Robinhood testnet; this script has no mainnet mode");
  const env = parseEnv(await readFile(envPath, "utf8"));
  const rpcUrl = env.RH_TESTNET_RPC || officialRpc;
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY || env.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
  const configuredAddress = env.RH_TESTNET_DEPLOYER_ADDRESS || env.RH_MAINNET_DEPLOYER_ADDRESS;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Set RH_TESTNET_DEPLOYER_PRIVATE_KEY in contracts/.env");
  const account = privateKeyToAccount(privateKey);
  if (!configuredAddress || !isAddress(configuredAddress) || getAddress(configuredAddress) !== getAddress(account.address)) {
    throw new Error("Testnet deployer address does not match its private key");
  }

  const chain = defineChain({
    id: chainIdExpected,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = makePinnedRpcTransport(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const [chainId, blockNumber, balance] = await Promise.all([
    publicClient.getChainId(), publicClient.getBlockNumber(), publicClient.getBalance({ address: account.address }),
  ]);
  if (chainId !== chainIdExpected) throw new Error(`Wrong network (chain ID ${chainId}); refusing to broadcast`);
  if (balance === 0n) throw new Error("Testnet deployer has no ETH for gas");
  console.log(`Robinhood testnet ${chainId}; block ${blockNumber}; deployer ${account.address}; balance ${formatEther(balance)} ETH`);

  for (const [name, address] of Object.entries(core)) {
    if (!(await codeAt(publicClient, address))) throw new Error(`Official testnet ${name} has no code; refusing deployment`);
    console.log(`${name}: verified existing code at ${address}`);
  }

  const manifest = await loadManifest(getAddress(account.address));
  manifest.lastCheckedBlock = blockNumber.toString();
  await saveManifest(manifest);
  const deployer = getAddress(account.address);
  const botEcdsaAccount = await getTestnetBotEcdsaAccount();
  const helper = await deployHelper(publicClient, walletClient, account, manifest);
  const usdg = await deployContract({ name: "TestUSDG", publicClient, walletClient, account, manifest });
  const verifier = await deployContract({ name: "MLDSA44Verifier", args: [helper], publicClient, walletClient, account, manifest });
  const registry = await deployContract({ name: "MarketRegistry", args: [deployer, shortTestnet], publicClient, walletClient, account, manifest });
  const keyRegistry = await deployContract({ name: "PQKeyRegistry", args: [deployer, verifier], publicClient, walletClient, account, manifest });
  const factory = await deployContract({ name: "MarketFactory", args: [deployer, usdg, core.PoolManager, registry, keyRegistry, verifier, shortTestnet], publicClient, walletClient, account, manifest });
  if (env.RH_TESTNET_RESOLVER_SIGNER_ADDRESS && !isAddress(env.RH_TESTNET_RESOLVER_SIGNER_ADDRESS)) throw new Error("RH_TESTNET_RESOLVER_SIGNER_ADDRESS is invalid");
  const resolverSigner = env.RH_TESTNET_RESOLVER_SIGNER_ADDRESS
    ? getAddress(env.RH_TESTNET_RESOLVER_SIGNER_ADDRESS)
    : getAddress(botEcdsaAccount.address);
  const resolver = await deployContract({ name: "ResolutionAdapter", args: [registry, keyRegistry, verifier, resolverSigner], publicClient, walletClient, account, manifest });
  const hookDeployer = await deployContract({ name: "TimelineHookDeployer", args: [factory], publicClient, walletClient, account, manifest });
  const router = await deployContract({ name: "TimelineRouter", args: [core.PoolManager, registry], publicClient, walletClient, account, manifest });
  const voting = await deployContract({ name: "QTLVoting", args: [deployer], publicClient, walletClient, account, manifest });

  await writeAndConfirm({ address: factory, name: "MarketFactory", functionName: "setHookDeployer", args: [hookDeployer], publicClient, walletClient, account, manifest, key: "factoryHookDeployerSet" });
  await writeAndConfirm({ address: registry, name: "MarketRegistry", functionName: "wireAndSeal", args: [factory, resolver], publicClient, walletClient, account, manifest, key: "registryWiredAndSealed" });
  manifest.addresses = { ...core, TestUSDG: usdg, F1600Helper: helper, MLDSA44Verifier: verifier, MarketRegistry: registry, PQKeyRegistry: keyRegistry, MarketFactory: factory, ResolutionAdapter: resolver, TimelineHookDeployer: hookDeployer, TimelineRouter: router, QTLVoting: voting };
  manifest.resolverSigner = resolverSigner;
  manifest.shortTestnetMode = shortTestnet;
  const deployerPqKey = await getTestnetPqKey("deployer");
  await registerTestnetKey({ role: "deployer", signer: deployer, ecdsaAccount: account, keyRegistry, verifier, publicClient, walletClient, account, manifest });
  await registerTestnetKey({ role: "bot", signer: getAddress(botEcdsaAccount.address), ecdsaAccount: botEcdsaAccount, keyRegistry, verifier, publicClient, walletClient, account, manifest });
  await sealTestnetKeys({ keyRegistry, publicClient, walletClient, account, manifest });

  const tokenArtifact = await loadArtifact("TestUSDG");
  const tokenBalance = await publicClient.readContract({ address: usdg, abi: tokenArtifact.abi, functionName: "balanceOf", args: [deployer] });
  if (tokenBalance < 10_000_000_000n) {
    const hash = await walletClient.writeContract({ account, address: usdg, abi: tokenArtifact.abi, functionName: "faucet", args: [deployer, 10_000_000_000n - tokenBalance] });
    console.log(`TestUSDG.faucet tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error("Testnet USDG faucet smoke transaction failed");
    manifest.wiring.testUsdGFaucet = { transactionHash: hash, blockNumber: receipt.blockNumber.toString(), amount: "10000000000" };
    await saveManifest(manifest);
  }

  const smoke = await createSmokeMarket({ deployerKey: deployerPqKey, factory, registry, keyRegistry, hookDeployer, usdg, publicClient, walletClient, account, manifest });
  await verifyTestnetStack({ manifest, publicClient, account });
  manifest.pqKeyRegistrySealed = true;
  manifest.marketCreated = true;
  manifest.marketActivated = Boolean(smoke.activated);
  manifest.testUsdGBalance = (await publicClient.readContract({ address: usdg, abi: tokenArtifact.abi, functionName: "balanceOf", args: [deployer] })).toString();
  manifest.note = smoke.activated
    ? `Testnet-only smoke market is activated (${smoke.status}); chain time and cutoff control trading.`
    : "Testnet-only smoke market is a Draft with initialized pools; it remains inactive until all three pools are seeded with liquidity.";
  await saveManifest(manifest);
  console.log(`Deployment manifest: ${manifestPath}`);
  console.log(`Testnet smoke market ${smoke.marketId}: ${smoke.activated ? "activated" : "Draft"}; seeded liquidity ${manifest.liquiditySeed?.positionLiquidity?.join(", ") || "not yet recorded"}.`);
  const governanceState = manifest.testnetVoting?.complete ? "Voting deposit/vote/finalize/withdraw receipts are recorded." : "Voting deposit/vote/finalize/withdraw still need a smoke run.";
  console.log(`ECDSA + ML-DSA registry, market creation, hook deployment, v4 initialization, and collateral split/merge have been exercised. ${governanceState} Trade, resolution, and redemption testnet flows remain pending.`);
} catch (error) {
  console.error(`Testnet deployment stopped: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}


