import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, defineChain, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertTestnetManifest } from './testnet-report.mjs';

const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || 'deployments/robinhood-testnet-current-vault.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertTestnetManifest(manifest);
const envText = await readFile(resolve(root, 'contracts/.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const i = line.indexOf('=');
  return i < 1 || line.trim().startsWith('#') ? [] : [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"](.*)['"]$/, '$1')]];
}));
const rpc = process.env.QT_TESTNET_RPC || env.RH_TESTNET_RPC;
const relayerKey = process.env.QT_TESTNET_RELAYER_PRIVATE_KEY || env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
const botKey = process.env.QT_TESTNET_RESOLVER_ECDSA_PRIVATE_KEY || (await readFile(resolve(root, 'contracts/.secrets/testnet-bot-ecdsa.hex'), 'utf8')).trim();
const pqPem = process.env.QT_TESTNET_RESOLVER_MLDSA_PRIVATE_KEY_PEM || await readFile(resolve(root, 'contracts/.secrets/testnet-bot-mldsa44.pem'), 'utf8');
if (!rpc || !relayerKey) throw new Error('Missing testnet RPC or relayer private key.');
const relayer = privateKeyToAccount(relayerKey.trim());
const signer = privateKeyToAccount(botKey.trim());
if (relayer.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error('Testnet relayer key does not match manifest deployer.');
if (signer.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('Resolver ECDSA key does not match manifest signer.');

const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc) });
const chainId = await client.getChainId();
if (chainId !== 46630) throw new Error(`RPC reported chain ID ${chainId}; expected 46630.`);
let marketStatus;
if (process.env.BEA_PERIOD_ID) {
  const registry = JSON.parse(await readFile(resolve(root, 'contracts/out/MarketRegistry.sol/MarketRegistry.json'), 'utf8'));
  const market = await client.readContract({ address: manifest.addresses.MarketRegistry, abi: registry.abi, functionName: 'market', args: [manifest.smokeMarket.marketId] });
  if (market.periodId.toLowerCase() !== keccak256(stringToHex(process.env.BEA_PERIOD_ID)).toLowerCase()) throw new Error('Testnet market does not match BEA_PERIOD_ID.');
  if (!market.activated) throw new Error('Testnet market is not activated.');
  if (BigInt(manifest.smokeMarket.releaseAt) !== market.releaseAt || BigInt(manifest.smokeMarket.deadline) !== market.deadline) throw new Error('Manifest release window does not match on-chain market state.');
  marketStatus = Number(market.status);
}
const digest = keccak256(stringToHex('qtimeline:testnet-resolver-key-check:v1'));
const signature = `0x${signMldsa(null, Buffer.from(digest.slice(2), 'hex'), createPrivateKey(pqPem)).toString('hex')}`;
const verifier = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8'));
const mldsaRegistered = await client.readContract({
  address: manifest.addresses.MLDSA44Verifier,
  abi: verifier.abi,
  functionName: 'verify',
  args: [manifest.testnetKeys.bot.pkBlob, digest, signature],
});
if (!mldsaRegistered) throw new Error('Testnet bot ML-DSA private key does not match the registered public key.');
console.log(JSON.stringify({ chainId, relayerMatchesManifest: true, ecdsaMatchesManifest: true, mldsaMatchesRegisteredBotKey: true, marketStatus, transactionSent: false }, null, 2));
