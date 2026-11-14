export function normalizeMainnetSeedHex(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    if (bytes.length !== 32) throw new Error('Mainnet resolver ML-DSA-44 seed must contain exactly 32 bytes.');
    return bytes.toString('hex');
  }

  const hex = String(value ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Mainnet resolver ML-DSA-44 seed must contain exactly 32 bytes.');
  return hex.toLowerCase();
}
