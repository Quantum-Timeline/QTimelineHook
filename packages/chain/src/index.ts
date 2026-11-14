import { defineChain, parseAbi } from "viem";

const testnet = process.env.NEXT_PUBLIC_RH_CHAIN_ID === "46630";

export const robinhoodChain = defineChain({
  id: testnet ? 46630 : 4663,
  name: testnet ? "Robinhood Chain Testnet" : "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [testnet ? "https://rpc.testnet.chain.robinhood.com" : "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: testnet ? "https://explorer.testnet.chain.robinhood.com" : "https://robinhoodchain.blockscout.com" } },
});

export const registryAbi = parseAbi([
  "function market(bytes32) view returns ((bytes32 configHash,address vault,address asset,uint64 opensAt,uint64 cutoffAt,uint64 releaseAt,uint64 deadline,bytes32 periodId,int32 thresholdBps,uint8 status,bool activated))",
  "function isRegisteredPool(bytes32,bytes32) view returns (bool)",
  "function syncTime(bytes32) returns (uint8)",
]);

export type DeploymentManifest = {
  chainId: number;
  deploymentBlock: bigint;
  factory: `0x${string}`;
  registry: `0x${string}`;
  resolver: `0x${string}`;
  router: `0x${string}`;
  voting: `0x${string}`;
  explorerUrl: string;
  verified: boolean;
};
