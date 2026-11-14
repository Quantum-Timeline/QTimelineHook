import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { inspectMainnetMlDsaKey, nonDegenerateT1CoefficientCount } from "../lib/mainnet-ml-dsa-key-validation.mjs";
import { deriveMainnetMlDsaKeyPair } from "../lib/mainnet-ml-dsa-keypair.mjs";

const seed = Buffer.alloc(32);
const privateKey = createPrivateKey({ key: seed, format: "raw-seed", asymmetricKeyType: "ml-dsa-44" });
const publicKey = createPublicKey(privateKey).export({ format: "raw-public" });

test("mainnet ML-DSA key is accepted only when the pinned FIPS KeyGen seed reproduces its public key", () => {
  const valid = inspectMainnetMlDsaKey({ seed, publicKey });
  assert.equal(valid.seedBound, true);
  assert.equal(valid.publicKeyFingerprint.length, 66);
  assert.equal(valid.preparedBlob.length, 20_545);
  assert.ok(valid.nonDegeneracyFloorCount >= 512);

  const alteredPublicKey = Buffer.from(publicKey);
  alteredPublicKey[40] ^= 1;
  assert.throws(() => inspectMainnetMlDsaKey({ seed, publicKey: alteredPublicKey }), /KeyGen seed does not reproduce/);
});

test("ML-DSA floor rejects both low and high extreme t1 coefficients", () => {
  const zeroT1 = Buffer.concat([Buffer.alloc(32), Buffer.alloc(1280)]);
  const maxT1 = Buffer.concat([Buffer.alloc(32), Buffer.alloc(1280, 0xff)]);
  assert.equal(nonDegenerateT1CoefficientCount(zeroT1), 0);
  assert.equal(nonDegenerateT1CoefficientCount(maxT1), 0);
});

test("Mainnet ML-DSA pair keeps a KeyObject for verification and raw bytes for blob validation", () => {
  const pair = deriveMainnetMlDsaKeyPair(seed);
  const message = Buffer.from("mainnet registration proof");
  const signature = sign(null, message, pair.privateKey);

  assert.equal(pair.publicKey.asymmetricKeyType, "ml-dsa-44");
  assert.equal(pair.publicKeyBytes.length, 1_312);
  assert.equal(verify(null, message, pair.publicKey, signature), true);
});
