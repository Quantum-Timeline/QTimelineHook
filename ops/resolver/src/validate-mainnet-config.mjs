import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, defineChain, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertMainnetManifest } from './mainnet-report.mjs';
import { normalizeMainnetSeedHex } from './mainnet-seed.mjs';

const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_MAINNET_MANIFEST || 'deployments/robinhood-mainnet.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertMainnetManifest(manifest);
if (manifest.deployedAndSealed !== true || manifest.wiring?.verified !== true) throw new Error('Mainnet deployment is not fully wired and sealed.');

let localEnvText = '';
try { localEnvText = await readFile(resolve(root, 'contracts/.env'), 'utf8'); } catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const localEnv = Object.fromEntries(localEnvText.split(/\r?\n/).flatMap((line) => {
  const index = line.indexOf('=');
  return index < 1 || line.trim().startsWith('#') ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"](.*)['"]$/, '$1')]];
}));
const rpc = process.env.QT_MAINNET_RPC || localEnv.RH_MAINNET_RPC;
const resolverKey = process.env.QT_MAINNET_RESOLVER_ECDSA_PRIVATE_KEY || (await readFile(resolve(root, 'contracts/.secrets/mainnet-bot-ecdsa.hex'), 'utf8')).trim();
const relayerKey = process.env.QT_MAINNET_RELAYER_PRIVATE_KEY || localEnv.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
const relayerExpectedAddress = process.env.QT_MAINNET_RELAYER_ADDRESS || localEnv.RH_MAINNET_DEPLOYER_ADDRESS;
const seedValue = process.env.QT_MAINNET_RESOLVER_MLDSA_SEED_HEX
  || await readFile(resolve(root, 'contracts/.secrets/mainnet-bot-mldsa44.seed'));
const seedHex = normalizeMainnetSeedHex(seedValue);
if (!rpc || !relayerKey || !relayerExpectedAddress) throw new Error('Missing Mainnet RPC or relayer address/key configuration.');

const resolver = privateKeyToAccount(resolverKey.trim());
const relayer = privateKeyToAccount(relayerKey.trim());
if (resolver.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('Mainnet resolver ECDSA key does not match manifest.');
if (relayer.address.toLowerCase() !== relayerExpectedAddress.toLowerCase()) throw new Error('Mainnet relayer key does not match configured address.');
if (relayer.address.toLowerCase() === resolver.address.toLowerCase()) throw new Error('Mainnet relayer and resolver signer must be separate wallets.');

const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const client = createPublicClient({ chain, transport: http(rpc) });
const chainId = await client.getChainId();
if (chainId !== 4663) throw new Error(`RPC reported chain ID ${chainId}; expected Robinhood Chain Mainnet 4663.`);

const adapterAbi = JSON.parse(await readFile(resolve(root, 'contracts/out/ResolutionAdapter.sol/ResolutionAdapter.json'), 'utf8')).abi;
const verifierAbi = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8')).abi;
const registryAbi = JSON.parse(await readFile(resolve(root, 'contracts/out/MarketRegistry.sol/MarketRegistry.json'), 'utf8')).abi;
const [authorizedSigner, relayerBalance, resolverBalance] = await Promise.all([
  client.readContract({ address: manifest.addresses.ResolutionAdapter, abi: adapterAbi, functionName: 'authorizedSigner' }),
  client.getBalance({ address: relayer.address }),
  client.getBalance({ address: resolver.address }),
]);
if (authorizedSigner.toLowerCase() !== resolver.address.toLowerCase()) throw new Error('On-chain adapter signer does not match Mainnet resolver.');
const keyBlob = manifest.keyValidation?.bot?.pkBlob || manifest.deployments?.botPKBlob?.address;
const challenge = keccak256(stringToHex('qtimeline:mainnet-resolver-key-check:v1'));
const privateKey = createPrivateKey({ key: Buffer.from(seedHex, 'hex'), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-44' });
const signature = `0x${signMldsa(null, Buffer.from(challenge.slice(2), 'hex'), privateKey).toString('hex')}`;
const mldsaAccepted = await client.readContract({ address: manifest.addresses.MLDSA44Verifier, abi: verifierAbi, functionName: 'verify', args: [keyBlob, challenge, signature] });
if (!mldsaAccepted) throw new Error('Mainnet ML-DSA resolver seed does not match the registered key blob.');

let marketStatus;
const marketId = process.env.QT_MAINNET_MARKET_ID || manifest.mainnetMarket?.marketId;
if (marketId) {
  const period = process.env.BEA_PERIOD_ID || manifest.mainnetMarket?.period;
  if (!period) throw new Error('Set BEA_PERIOD_ID for the configured Mainnet market.');
  const market = await client.readContract({ address: manifest.addresses.MarketRegistry, abi: registryAbi, functionName: 'market', args: [marketId] });
  if (market.periodId.toLowerCase() !== keccak256(stringToHex(period)).toLowerCase()) throw new Error('Mainnet market period does not match BEA_PERIOD_ID.');
  if (!market.activated && Number(market.status) < 4) throw new Error('Mainnet market is not activated.');
  marketStatus = Number(market.status);
}

console.log(JSON.stringify({
  chainId,
  manifestChainId: manifest.chainId,
  deploymentSealed: manifest.deployedAndSealed,
  wiringVerified: manifest.wiring.verified,
  resolverMatchesManifest: true,
  adapterSignerMatches: true,
  relayerMatchesConfiguredAddress: true,
  mldsaMatchesRegisteredBotKey: mldsaAccepted,
  relayerBalance: relayerBalance.toString(),
  resolverBalance: resolverBalance.toString(),
  marketStatus,
  transactionSent: false,
}, null, 2));
