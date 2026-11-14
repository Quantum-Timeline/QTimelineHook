import { createPublicClient, defineChain, getCreate2Address, http, isHex } from 'viem';
const robinhoodChain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.robinhoodchain.com'] } } });

const rpc = process.env.RH_MAINNET_RPC;
const deployer = process.env.QT_HOOK_DEPLOYER;
const marketId = process.env.QT_MARKET_ID;
if (!rpc || !deployer || !marketId || !isHex(marketId) || marketId.length !== 66) throw new Error('Set RH_MAINNET_RPC, QT_HOOK_DEPLOYER and a 32-byte QT_MARKET_ID.');
const client = createPublicClient({ chain: robinhoodChain, transport: http(rpc) });
const abi = [{ type: 'function', name: 'initCodeHash', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'bytes32' }] }];
const manager = process.env.QT_POOL_MANAGER;
const registry = process.env.QT_MARKET_REGISTRY;
if (!manager || !registry) throw new Error('Set QT_POOL_MANAGER and QT_MARKET_REGISTRY.');
const bytecodeHash = await client.readContract({ address: deployer, abi, functionName: 'initCodeHash', args: [manager, registry, marketId] });
for (let i = 0n; ; i++) {
  const salt = `0x${i.toString(16).padStart(64, '0')}`;
  const address = getCreate2Address({ from: deployer, salt, bytecodeHash });
  if ((BigInt(address) & 0x2880n) === 0x2880n) {
    console.log(JSON.stringify({ salt, predictedHook: address, requiredMask: '0x2880', attempts: (i + 1n).toString() }, null, 2));
    break;
  }
}
