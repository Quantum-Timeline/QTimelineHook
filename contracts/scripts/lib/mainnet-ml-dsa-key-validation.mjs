import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = process.cwd();
const require = createRequire(resolve(root, "apps/web/package.json"));
const { keccak256 } = require("viem");
const minimumFloorCount = 512;
const virtualEnvPython = resolve(root, "contracts/.secrets/pythonref-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

function runPython(pythonPath, script, input) {
  const result = spawnSync(pythonPath, [script], { input, encoding: "utf8", maxBuffer: 1_000_000, cwd: root });
  if (result.error) throw new Error(`Could not run Python key validator: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Python key validation failed: ${(result.stderr || result.stdout || "unknown error").trim().slice(0, 600)}`);
  return result.stdout.trim();
}

export function nonDegenerateT1CoefficientCount(publicKey) {
  const bytes = Buffer.from(publicKey);
  if (bytes.length !== 1312) throw new Error("ML-DSA-44 public key must be 1,312 bytes");
  let accumulator = 0n;
  let bits = 0;
  let aboveFloor = 0;
  let count = 0;
  const q = 8_380_417n;
  const gamma2 = (q - 1n) / 88n;

  for (const byte of bytes.subarray(32)) {
    accumulator |= BigInt(byte) << BigInt(bits);
    bits += 8;
    while (bits >= 10 && count < 1024) {
      const encoded = accumulator & 1023n;
      const lifted = (encoded << 13n) % q;
      const centered = lifted > q / 2n ? lifted - q : lifted;
      if ((centered < 0n ? -centered : centered) > gamma2) aboveFloor += 1;
      accumulator >>= 10n;
      bits -= 10;
      count += 1;
    }
  }
  if (count !== 1024) throw new Error("Could not decode all 1,024 ML-DSA-44 t1 coefficients");
  return aboveFloor;
}

export function inspectMainnetMlDsaKey({ seed, publicKey, pythonPath = process.env.QTIMELINE_MLDSA_PYTHON || (existsSync(virtualEnvPython) ? virtualEnvPython : "python") }) {
  const seedBytes = Buffer.from(seed);
  const publicKeyBytes = Buffer.from(publicKey);
  if (seedBytes.length !== 32) throw new Error("ML-DSA-44 KeyGen seed must be 32 bytes");
  if (publicKeyBytes.length !== 1312) throw new Error("ML-DSA-44 public key must be 1,312 bytes");

  const referencePath = resolve(root, "contracts/lib/evm-ml-dsa-verifier/pythonref");
  const keygenScript = resolve(root, "contracts/scripts/lib/derive_mldsa44_public_key.py");
  const derivedPublicKeyHex = runPython(pythonPath, keygenScript, JSON.stringify({ referencePath, seed: seedBytes.toString("hex") }));
  const expectedPublicKeyHex = derivedPublicKeyHex.startsWith("{")
    ? JSON.parse(derivedPublicKeyHex).publicKey
    : derivedPublicKeyHex;
  if (expectedPublicKeyHex.toLowerCase() !== publicKeyBytes.toString("hex")) {
    throw new Error("ML-DSA KeyGen seed does not reproduce the supplied public key");
  }

  const nonDegeneracyFloorCount = nonDegenerateT1CoefficientCount(publicKeyBytes);
  if (nonDegeneracyFloorCount < minimumFloorCount) {
    throw new Error(`ML-DSA public key is below the mandatory centred-lift floor (${nonDegeneracyFloorCount}/1024)`);
  }

  const prepareScript = resolve(root, "contracts/lib/evm-ml-dsa-verifier/prepare/prepare.py");
  const preparedHex = runPython(pythonPath, prepareScript, publicKeyBytes.toString("hex"));
  const preparedBlob = Buffer.from(preparedHex, "hex");
  if (preparedBlob.length !== 20_545 || preparedBlob[0] !== 0) {
    throw new Error("Prepared ML-DSA blob has invalid length or EIP-3541 prefix");
  }

  return {
    seedBound: true,
    nonDegeneracyFloorCount,
    publicKeyFingerprint: `0x${createHash("sha256").update(publicKeyBytes).digest("hex")}`,
    preparedBlob,
    preparedBlobCodeHash: keccak256(`0x${preparedBlob.toString("hex")}`),
  };
}
