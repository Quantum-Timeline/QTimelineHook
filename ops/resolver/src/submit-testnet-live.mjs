import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fetchOfficialRelease, makeEvidence, officialReleaseUrl, parseCorePce } from './bea.mjs';
import { assertTestnetManifest, buildTestnetReport, terminalOutcome } from './testnet-report.mjs';

async function main() {
const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || 'deployments/robinhood-testnet-current-vault.json');
const period = process.env.BEA_PERIOD_ID;
if (!period) throw new Error('Set BEA_PERIOD_ID');
const expectedUrl = officialReleaseUrl(period);
const releaseUrl = process.env.BEA_RELEASE_URL || expectedUrl;
if (new URL(releaseUrl).href !== expectedUrl) throw new Error(`BEA_RELEASE_URL must exactly match the canonical article URL: ${expectedUrl}`);
const fetched = await fetchOfficialRelease(releaseUrl);
if (!fetched.published) {
  console.log(JSON.stringify({ chainId: 46630, period, published: false, httpStatus: fetched.status, transactionSent: false }));
  return;
}

const parsed = parseCorePce(fetched.html, period);
const { evidence, canonicalJson, evidenceHash } = makeEvidence({
  url: fetched.url,
  periodId: period,
  printedValue: parsed.printed,
  html: fetched.html,
  fetchedAt: new Date().toISOString(),
});
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertTestnetManifest(manifest);
if (process.env.QT_BROADCAST !== '1') throw new Error('Set QT_BROADCAST=1 to allow a Robinhood testnet report.');

const rpc = process.env.QT_TESTNET_RPC;
const botEcdsaKey = process.env.QT_TESTNET_RESOLVER_ECDSA_PRIVATE_KEY;
const pqPrivatePem = process.env.QT_TESTNET_RESOLVER_MLDSA_PRIVATE_KEY_PEM;
const relayerKey = process.env.QT_TESTNET_RELAYER_PRIVATE_KEY;
if (!rpc || !botEcdsaKey || !pqPrivatePem || !relayerKey) throw new Error('Missing one or more testnet GitHub Actions secrets.');
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc) });
if (await publicClient.getChainId() !== 46630) throw new Error('RPC is not Robinhood Chain Testnet; no transaction sent.');
const signer = privateKeyToAccount(botEcdsaKey.trim());
if (signer.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('Testnet resolver ECDSA key does not match the manifest.');
const relayer = privateKeyToAccount(relayerKey.trim());
if (relayer.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error('Testnet relayer key does not match the manifest deployer.');

const registryArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MarketRegistry.sol/MarketRegistry.json'), 'utf8'));
const adapterArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/ResolutionAdapter.sol/ResolutionAdapter.json'), 'utf8'));
const verifierArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8'));
const marketId = manifest.smokeMarket?.marketId;
if (!marketId) throw new Error('Manifest is missing smokeMarket.marketId.');
const market = await publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] });
if (market.periodId.toLowerCase() !== keccak256(stringToHex(period)).toLowerCase()) throw new Error('On-chain testnet market period does not match the BEA release.');
const priorOutcome = terminalOutcome(market.status);
if (priorOutcome) {
  const result = { chainId: 46630, marketId, period, published: true, alreadyFinal: true, finalStatus: priorOutcome, newTransactionSent: false };
  if (Number(market.status) === 4 || Number(market.status) === 5) {
    const [reportedValueBps, reportedEvidenceHash] = await Promise.all([
      publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
      publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
    ]);
    result.reportedValueBps = Number(reportedValueBps);
    result.reportedEvidenceHash = reportedEvidenceHash;
    result.sourceValueMatchesFinal = Number(reportedValueBps) === parsed.valueBps;
  }
  await writeFile(resolve(root, 'resolver-result.json'), `${JSON.stringify({ ...result, currentSourceValueBps: parsed.valueBps, evidence, canonicalEvidence: canonicalJson, evidenceHash }, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return;
}
if (!market.activated) throw new Error('Testnet market is not activated.');
const report = buildTestnetReport({ marketId, market, period, valueBps: parsed.valueBps, evidenceHash });
const block = await publicClient.getBlock();
if (block.timestamp < market.releaseAt) {
  console.log(JSON.stringify({ chainId: 46630, marketId, period, published: true, awaitingReleaseAt: market.releaseAt.toString(), transactionSent: false }));
  return;
}
if (block.timestamp >= market.deadline) throw new Error('Report deadline passed; no transaction sent.');

const domain = { name: 'QTimeline', version: '1', chainId: 46630, verifyingContract: manifest.addresses.ResolutionAdapter };
const types = { ReportValue: [
  { name: 'marketId', type: 'bytes32' }, { name: 'sourceId', type: 'bytes32' }, { name: 'periodId', type: 'bytes32' },
  { name: 'valueBps', type: 'int32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'signatureExpiry', type: 'uint64' },
] };
const message = { domain, types, primaryType: 'ReportValue', message: report };
const digest = hashTypedData(message);
const ecdsaSignature = await signer.signTypedData(message);
const pqPrivateKey = createPrivateKey(pqPrivatePem);
const pqSignature = `0x${signMldsa(null, Buffer.from(digest.slice(2), 'hex'), pqPrivateKey).toString('hex')}`;
const pqAccepted = await publicClient.readContract({ address: manifest.addresses.MLDSA44Verifier, abi: verifierArtifact.abi, functionName: 'verify', args: [manifest.testnetKeys.bot.pkBlob, digest, pqSignature] });
if (!pqAccepted) throw new Error('Testnet ML-DSA verifier rejected the live BEA report signature.');

const args = [report, stringToHex(canonicalJson), ecdsaSignature, pqSignature];
const { request } = await publicClient.simulateContract({ account: relayer, address: manifest.addresses.ResolutionAdapter, abi: adapterArtifact.abi, functionName: 'reportValue', args });
const walletClient = createWalletClient({ account: relayer, chain, transport: http(rpc) });
const txHash = await walletClient.writeContract(request);
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
if (receipt.status !== 'success') throw new Error(`Testnet report transaction reverted: ${txHash}`);
const [finalMarket, reportedValueBps, reportedEvidenceHash] = await Promise.all([
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] }),
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
]);
const finalStatus = parsed.valueBps >= Number(market.thresholdBps) ? 'Final YES' : 'Final NO';
const expectedStatus = finalStatus === 'Final YES' ? 4 : 5;
if (Number(finalMarket.status) !== expectedStatus || Number(reportedValueBps) !== parsed.valueBps || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
  throw new Error('On-chain final status, value, or evidence hash did not match the parsed BEA release.');
}
const result = { chainId: 46630, marketId, period, printed: parsed.printed, valueBps: parsed.valueBps, thresholdBps: Number(market.thresholdBps), ecdsaSigner: signer.address, relayer: relayer.address, mldsaAccepted: pqAccepted, evidence, canonicalEvidence: canonicalJson, evidenceHash, transactionHash: txHash, blockNumber: receipt.blockNumber.toString(), finalStatus, testnetOnly: true };
await writeFile(resolve(root, 'resolver-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
}

await main();
