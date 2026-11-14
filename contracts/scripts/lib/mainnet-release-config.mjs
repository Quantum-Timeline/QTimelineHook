export const MAINNET_CHAIN_ID = 4663;

export const MAINNET_CORE = Object.freeze({
  PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
});

export function validateMainnetSigners({ chainId, deployer, resolver }) {
  if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Mainnet deployment requires chain ID ${MAINNET_CHAIN_ID}`);
  for (const [name, address] of [["deployer", deployer], ["resolver", resolver]]) {
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid ${name} ECDSA address`);
  }
  if (deployer.toLowerCase() === resolver.toLowerCase()) throw new Error("Mainnet deployer and resolver signers must be distinct");
}

export function requireMainnetBroadcast(argv) {
  if (argv.includes("--preflight")) return false;
  if (!argv.includes("--broadcast")) throw new Error("Mainnet writes are disabled unless --broadcast is explicitly provided");
  return true;
}
