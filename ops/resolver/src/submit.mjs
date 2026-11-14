import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, privateKeyToAccount, stringToHex } from 'viem';
import { parseCorePce, makeEvidence, SOURCE_ID } from './bea.mjs';

const robinhoodChain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.robinhoodchain.com'] } } });

const rpc = process.env.RH_MAINNET_RPC;
const adapter = process.env.QT_RESOLUTION_ADAPTER;
const registry = process.env.QT_MARKET_REGISTRY;
const marketId = process.env.QT_MARKET_ID;
const period = process.env.BEA_PERIOD_ID;
const releaseUrl = process.env.BEA_RELEASE_URL;
const ecdsaKey = process.env.QT_RESOLVER_ECDSA_PRIVATE_KEY;
const pqKeyPath = process.env.QT_RESOLVER_MLDSA_PRIVATE_KEY_PATH;
if (![rpc, adapter, registry, marketId, period, releaseUrl, ecdsaKey, pqKeyPath].every(Boolean)) {
  throw new Error('Missing resolver config: RPC, adapter, registry, market, period, BEA URL and isolated signer keys are required.');
}
const url = new URL(releaseUrl);
if (url.protocol !== 'https:' || url.hostname !== 'www.bea.gov') throw new Error('Resolver only accepts official BEA HTTPS URLs.');
const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'QTimeline-BEA-resolver/0.1' } });
if (!response.ok) throw new Error(`BEA returned HTTP ${response.status}`);
if (new URL(response.url).hostname !== 'www.bea.gov') throw new Error('BEA redirect left official host.');
const html = await response.text();
const parsed = parseCorePce(html, period);
const { canonicalJson, evidenceHash } = makeEvidence({ url: response.url, periodId: period, printedValue: parsed.printed, html, fetchedAt: new Date().toISOString() });

const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(rpc) });
const signer = privateKeyToAccount(ecdsaKey);
const walletClient = createWalletClient({ account: signer, chain: robinhoodChain, transport: http(rpc) });
const readAbi = [
  { type: 'function', name: 'authorizedSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'reportValue', stateMutability: 'nonpayable', inputs: [
    { name: 'r', type: 'tuple', components: [{ name: 'marketId', type: 'bytes32' }, { name: 'sourceId', type: 'bytes32' }, { name: 'periodId', type: 'bytes32' }, { name: 'valueBps', type: 'int32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'signatureExpiry', type: 'uint64' }] },
    { name: 'evidenceJson', type: 'bytes' }, { name: 'ecdsaSig', type: 'bytes' }, { name: 'pqSig', type: 'bytes' }
  ], outputs: [] }
];
const registryAbi = [{ type: 'function', name: 'market', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'configHash', type: 'bytes32' }, { name: 'vault', type: 'address' }, { name: 'asset', type: 'address' }, { name: 'opensAt', type: 'uint64' }, { name: 'cutoffAt', type: 'uint64' }, { name: 'releaseAt', type: 'uint64' }, { name: 'deadline', type: 'uint64' }, { name: 'periodId', type: 'bytes32' }, { name: 'thresholdBps', type: 'int32' }, { name: 'status', type: 'uint8' }, { name: 'activated', type: 'bool' }] }] }];
const onchainSigner = await publicClient.readContract({ address: adapter, abi: readAbi, functionName: 'authorizedSigner' });
if (onchainSigner.toLowerCase() !== signer.address.toLowerCase()) throw new Error('ECDSA signer does not match adapter authorization.');
const market = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'market', args: [marketId] });
const periodId = keccak256(stringToHex(period));
if (!market.activated || market.periodId !== periodId) throw new Error('Market inactive or configured period does not match BEA period.');
if (market.status >= 4) throw new Error('Market is already terminal.');
const deadline = market.deadline;
const report = { marketId, sourceId: keccak256(stringToHex(SOURCE_ID)), periodId, valueBps: parsed.valueBps, evidenceHash, signatureExpiry: deadline };
const domain = { name: 'QTimeline', version: '1', chainId: robinhoodChain.id, verifyingContract: adapter };
const types = { ReportValue: [
  { name: 'marketId', type: 'bytes32' }, { name: 'sourceId', type: 'bytes32' }, { name: 'periodId', type: 'bytes32' },
  { name: 'valueBps', type: 'int32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'signatureExpiry', type: 'uint64' }
] };
const ecdsaSig = await signer.signTypedData({ domain, types, primaryType: 'ReportValue', message: report });
const pem = await readFile(pqKeyPath, 'utf8');
const pqPrivateKey = createPrivateKey(pem);
const digest = Buffer.from(hashTypedData({ domain, types, primaryType: 'ReportValue', message: report }).slice(2), 'hex');
const pqSig = `0x${cryptoSign(null, digest, pqPrivateKey).toString('hex')}`;
const args = [report, stringToHex(canonicalJson), ecdsaSig, pqSig];
await publicClient.simulateContract({ account: signer, address: adapter, abi: readAbi, functionName: 'reportValue', args });
console.log(JSON.stringify({ marketId, period, printed: parsed.printed, valueBps: parsed.valueBps, evidenceHash, ecdsaSigner: signer.address, simulated: true }));
if (process.env.QT_BROADCAST !== '1') {
  console.error('Simulation passed; set QT_BROADCAST=1 only in the protected resolver workflow to submit.');
} else {
  const hash = await walletClient.writeContract({ address: adapter, abi: readAbi, functionName: 'reportValue', args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Resolution transaction reverted: ${hash}`);
  console.log(JSON.stringify({ transactionHash: hash, blockNumber: receipt.blockNumber.toString() }));
}
