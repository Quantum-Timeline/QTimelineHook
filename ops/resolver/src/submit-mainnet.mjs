import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fetchOfficialRelease, makeEvidence, officialReleaseUrl, parseCorePce } from './bea.mjs';
import { assertMainnetManifest, buildMainnetReport, terminalOutcome } from './mainnet-report.mjs';
import { normalizeMainnetSeedHex } from './mainnet-seed.mjs';

const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_MAINNET_MANIFEST || 'deployments/robinhood-mainnet.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertMainnetManifest(manifest);

const period = process.env.BEA_PERIOD_ID;
if (!period) throw new Error('Set BEA_PERIOD_ID.');
const canonicalUrl = officialReleaseUrl(period);
const releaseUrl = process.env.BEA_RELEASE_URL || canonicalUrl;
if (new URL(releaseUrl).href !== canonicalUrl) throw new Error(`BEA_RELEASE_URL must exactly match ${canonicalUrl}.`);

const marketId = process.env.QT_MAINNET_MARKET_ID || manifest.mainnetMarket?.marketId;
if (!marketId || !/^0x[0-9a-fA-F]{64}$/.test(marketId)) throw new Error('Set QT_MAINNET_MARKET_ID after the Mainnet market is created.');
const fetched = await fetchOfficialRelease(releaseUrl);
if (!fetched.published) {
  console.log(JSON.stringify({ chainId: 4663, period, published: false, httpStatus: fetched.status, transactionSent: false }));
  process.exit(0);
}

const parsed = parseCorePce(fetched.html, period);
const { evidence, canonicalJson, evidenceHash } = makeEvidence({
  url: fetched.url,
  periodId: period,
  printedValue: parsed.printed,
  html: fetched.html,
  fetchedAt: new Date().toISOString(),
});

let localEnvText = '';
try { localEnvText = await readFile(resolve(root, 'contracts/.env'), 'utf8'); } catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const localEnv = Object.fromEntries(localEnvText.split(/\r?\n/).flatMap((line) => {
  const index = line.indexOf('=');
  return index < 1 || line.trim().startsWith('#') ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"](.*)['"]$/, '$1')]];
}));
const rpc = process.env.QT_MAINNET_RPC || localEnv.RH_MAINNET_RPC;
if (!rpc) throw new Error('Set QT_MAINNET_RPC or RH_MAINNET_RPC.');
const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc) });
if (await publicClient.getChainId() !== 4663) throw new Error('RPC is not Robinhood Chain Mainnet; no transaction sent.');

let resolverKey = process.env.QT_MAINNET_RESOLVER_ECDSA_PRIVATE_KEY;
if (!resolverKey) resolverKey = (await readFile(resolve(root, 'contracts/.secrets/mainnet-bot-ecdsa.hex'), 'utf8')).trim();
const signer = privateKeyToAccount(resolverKey.trim());
if (signer.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('Mainnet resolver ECDSA key does not match the deployment manifest.');

let relayerKey = process.env.QT_MAINNET_RELAYER_PRIVATE_KEY;
if (!relayerKey) relayerKey = localEnv.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
if (!relayerKey) throw new Error('Set QT_MAINNET_RELAYER_PRIVATE_KEY or RH_MAINNET_DEPLOYER_PRIVATE_KEY.');
const relayer = privateKeyToAccount(relayerKey.trim());
const expectedRelayer = process.env.QT_MAINNET_RELAYER_ADDRESS || localEnv.RH_MAINNET_DEPLOYER_ADDRESS;
if (expectedRelayer && relayer.address.toLowerCase() !== expectedRelayer.toLowerCase()) throw new Error('Mainnet relayer key does not match its configured address.');
if (relayer.address.toLowerCase() === signer.address.toLowerCase()) throw new Error('Mainnet report relayer and resolver signer must be separate wallets.');

const registryArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MarketRegistry.sol/MarketRegistry.json'), 'utf8'));
const adapterArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/ResolutionAdapter.sol/ResolutionAdapter.json'), 'utf8'));
const verifierArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8'));
const registry = manifest.addresses.MarketRegistry;
const adapter = manifest.addresses.ResolutionAdapter;
const resolverAbi = [{ type: 'function', name: 'authorizedSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }];
const onchainSigner = await publicClient.readContract({ address: adapter, abi: resolverAbi, functionName: 'authorizedSigner' });
if (onchainSigner.toLowerCase() !== signer.address.toLowerCase()) throw new Error('ECDSA signer does not match Mainnet adapter authorization.');

const market = await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] });
if (market.periodId.toLowerCase() !== keccak256(stringToHex(period)).toLowerCase()) throw new Error('On-chain Mainnet market period does not match the BEA release.');
const priorOutcome = terminalOutcome(market.status);
if (priorOutcome) {
  const result = { chainId: 4663, marketId, period, published: true, alreadyFinal: true, finalStatus: priorOutcome, newTransactionSent: false };
  if (Number(market.status) === 4 || Number(market.status) === 5) {
    const [reportedValueBps, reportedEvidenceHash] = await Promise.all([
      publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
      publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
    ]);
    const expectedStatus = parsed.valueBps >= Number(market.thresholdBps) ? 4 : 5;
    if (Number(market.status) !== expectedStatus || Number(reportedValueBps) !== parsed.valueBps || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
      throw new Error('Final Mainnet market does not match the current official BEA release.');
    }
    result.reportedValueBps = Number(reportedValueBps);
    result.reportedEvidenceHash = reportedEvidenceHash;
  }
  await writeResult(root, { ...result, currentSourceValueBps: parsed.valueBps, evidence, canonicalEvidence: canonicalJson, evidenceHash });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
if (!market.activated) throw new Error('Mainnet market is not activated.');
const report = buildMainnetReport({ marketId, market, period, valueBps: parsed.valueBps, evidenceHash });
const block = await publicClient.getBlock();
if (block.timestamp < market.releaseAt) {
  console.log(JSON.stringify({ chainId: 4663, marketId, period, published: true, awaitingReleaseAt: market.releaseAt.toString(), transactionSent: false }));
  process.exit(0);
}
if (block.timestamp >= market.deadline) throw new Error('Report deadline passed; no transaction sent.');

const domain = { name: 'QTimeline', version: '1', chainId: 4663, verifyingContract: adapter };
const types = { ReportValue: [
  { name: 'marketId', type: 'bytes32' }, { name: 'sourceId', type: 'bytes32' }, { name: 'periodId', type: 'bytes32' },
  { name: 'valueBps', type: 'int32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'signatureExpiry', type: 'uint64' },
] };
const message = { domain, types, primaryType: 'ReportValue', message: report };
const digest = hashTypedData(message);
const ecdsaSignature = await signer.signTypedData(message);
let seedHex = process.env.QT_MAINNET_RESOLVER_MLDSA_SEED_HEX;
if (!seedHex) seedHex = await readFile(resolve(root, 'contracts/.secrets/mainnet-bot-mldsa44.seed'));
seedHex = normalizeMainnetSeedHex(seedHex);
const pqPrivateKey = createPrivateKey({ key: Buffer.from(seedHex, 'hex'), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-44' });
const pqSignature = `0x${signMldsa(null, Buffer.from(digest.slice(2), 'hex'), pqPrivateKey).toString('hex')}`;
const pqKeyBlob = manifest.keyValidation?.bot?.pkBlob || manifest.deployments?.botPKBlob?.address;
const pqAccepted = await publicClient.readContract({ address: manifest.addresses.MLDSA44Verifier, abi: verifierArtifact.abi, functionName: 'verify', args: [pqKeyBlob, digest, pqSignature] });
if (!pqAccepted) throw new Error('Mainnet ML-DSA verifier rejected the resolver signature.');

const args = [report, stringToHex(canonicalJson), ecdsaSignature, pqSignature];
const simulation = await publicClient.simulateContract({ account: relayer, address: adapter, abi: adapterArtifact.abi, functionName: 'reportValue', args });
const result = { chainId: 4663, marketId, period, printed: parsed.printed, valueBps: parsed.valueBps, thresholdBps: Number(market.thresholdBps), ecdsaSigner: signer.address, relayer: relayer.address, mldsaAccepted: pqAccepted, evidence, canonicalEvidence: canonicalJson, evidenceHash, simulated: true, transactionSent: false };
if (process.env.QT_BROADCAST !== '1') {
  await writeResult(root, result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const walletClient = createWalletClient({ account: relayer, chain, transport: http(rpc) });
const nonce = await publicClient.getTransactionCount({ address: relayer.address, blockTag: 'pending' });
const txHash = await walletClient.writeContract({ ...simulation.request, nonce });
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
if (receipt.status !== 'success') throw new Error(`Mainnet resolver transaction reverted: ${txHash}`);
const [finalMarket, reportedValueBps, reportedEvidenceHash] = await Promise.all([
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] }),
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
]);
const expectedStatus = parsed.valueBps >= Number(market.thresholdBps) ? 4 : 5;
if (Number(finalMarket.status) !== expectedStatus || Number(reportedValueBps) !== parsed.valueBps || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
  throw new Error('On-chain Mainnet final status, value, or evidence hash did not match the BEA release.');
}
const finalResult = { ...result, simulated: true, transactionSent: true, transactionHash: txHash, blockNumber: receipt.blockNumber.toString(), finalStatus: terminalOutcome(finalMarket.status) };
await writeResult(root, finalResult);
console.log(JSON.stringify(finalResult, null, 2));

async function writeResult(base, data) {
  const output = resolve(base, process.env.QT_RESOLVER_RESULT_PATH || 'resolver-result.json');
  await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
}
