import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { inspectMainnetMlDsaKey } from "./lib/mainnet-ml-dsa-key-validation.mjs";
import { validateMainnetSigners } from "./lib/mainnet-release-config.mjs";

const root = process.cwd();
const require = createRequire(resolve(root, "apps/web/package.json"));
const { getAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const secretDir = resolve(root, "contracts/.secrets");
const envPath = resolve(root, "contracts/.env");

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

async function loadOrCreateSeed(role) {
  const seedPath = resolve(secretDir, `mainnet-${role}-mldsa44.seed`);
  try {
    const seed = await readFile(seedPath);
    if (seed.length !== 32) throw new Error(`${role} ML-DSA seed file must contain exactly 32 bytes`);
    return seed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seed = randomBytes(32);
  try {
    await writeFile(seedPath, seed, { mode: 0o600, flag: "wx" });
    return seed;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const racedSeed = await readFile(seedPath);
    if (racedSeed.length !== 32) throw new Error(`${role} ML-DSA seed file must contain exactly 32 bytes`);
    return racedSeed;
  }
}

async function loadOrCreateResolverEcdsa() {
  const keyPath = resolve(secretDir, "mainnet-bot-ecdsa.hex");
  try {
    return privateKeyToAccount((await readFile(keyPath, "utf8")).trim());
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot load local Mainnet resolver ECDSA key");
  }
  for (;;) {
    const key = `0x${randomBytes(32).toString("hex")}`;
    try {
      const account = privateKeyToAccount(key);
      try {
        await writeFile(keyPath, `${key}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return account;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        return privateKeyToAccount((await readFile(keyPath, "utf8")).trim());
      }
    } catch (error) {
      if (error.code === "EEXIST") throw error;
    }
  }
}

try {
  await mkdir(secretDir, { recursive: true });
  const env = parseEnv(await readFile(envPath, "utf8"));
  if (!env.RH_MAINNET_DEPLOYER_PRIVATE_KEY) throw new Error("Missing RH_MAINNET_DEPLOYER_PRIVATE_KEY in contracts/.env");
  const deployer = privateKeyToAccount(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY);
  if (!env.RH_MAINNET_DEPLOYER_ADDRESS || getAddress(env.RH_MAINNET_DEPLOYER_ADDRESS) !== getAddress(deployer.address)) {
    throw new Error("RH_MAINNET_DEPLOYER_ADDRESS does not match its private key");
  }
  const resolver = await loadOrCreateResolverEcdsa();
  validateMainnetSigners({ chainId: 4663, deployer: deployer.address, resolver: resolver.address });

  const pythonPath = process.env.QTIMELINE_MLDSA_PYTHON || resolve(secretDir, "pythonref-venv/Scripts/python.exe");
  const keyEvidence = {};
  for (const role of ["deployer", "bot"]) {
    const seed = await loadOrCreateSeed(role);
    const privateKey = createPrivateKey({ key: seed, format: "raw-seed", asymmetricKeyType: "ml-dsa-44" });
    const publicKey = createPublicKey(privateKey).export({ format: "raw-public" });
    const inspected = inspectMainnetMlDsaKey({ seed, publicKey, pythonPath });
    const blobPath = resolve(secretDir, `mainnet-${role}-mldsa44-blob.hex`);
    await writeFile(blobPath, `${inspected.preparedBlob.toString("hex")}\n`, { encoding: "utf8", mode: 0o600 });
    keyEvidence[role] = {
      signer: role === "deployer" ? getAddress(deployer.address) : getAddress(resolver.address),
      mlDsa44SeedBinding: inspected.seedBound,
      publicKeyFingerprint: inspected.publicKeyFingerprint,
      preparedBlobCodeHash: inspected.preparedBlobCodeHash,
      nonDegeneracyFloorCount: inspected.nonDegeneracyFloorCount,
    };
  }

  const evidencePath = resolve(secretDir, "mainnet-key-validation.json");
  await writeFile(evidencePath, `${JSON.stringify({ chainId: 4663, keyValidation: "FIPS 204 KeyGen seed binding plus centred-lift hard floor", signers: keyEvidence }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({
    chainId: 4663,
    deployer: getAddress(deployer.address),
    resolver: getAddress(resolver.address),
    keys: keyEvidence,
    secretFiles: ["mainnet-bot-ecdsa.hex", "mainnet-deployer-mldsa44.seed", "mainnet-bot-mldsa44.seed", "mainnet-deployer-mldsa44-blob.hex", "mainnet-bot-mldsa44-blob.hex"],
    evidencePath: "contracts/.secrets/mainnet-key-validation.json",
    note: "Private signer material is local and ignored. Back up it offline before using these signers on Mainnet.",
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
