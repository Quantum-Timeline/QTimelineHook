import { createPrivateKey, createPublicKey } from "node:crypto";

export function deriveMainnetMlDsaKeyPair(seed) {
  const seedBytes = Buffer.from(seed);
  if (seedBytes.length !== 32) throw new Error("ML-DSA-44 KeyGen seed must be 32 bytes");

  const privateKey = createPrivateKey({ key: seedBytes, format: "raw-seed", asymmetricKeyType: "ml-dsa-44" });
  const publicKey = createPublicKey(privateKey);
  const publicKeyBytes = publicKey.export({ format: "raw-public" });
  if (publicKeyBytes.length !== 1_312) throw new Error("ML-DSA-44 public key must be 1,312 bytes");

  return { privateKey, publicKey, publicKeyBytes };
}
