import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseCorePce, makeEvidence } from './bea.mjs';
import { assertTestnetManifest, buildTestnetReport, terminalOutcome } from './testnet-report.mjs';

const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || 'deployments/robinhood-testnet-bea-mock.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertTestnetManifest(manifest);
if (process.env.QT_BROADCAST !== '1') throw new Error('Set QT_BROADCAST=1 to submit this explicitly testnet-only fixture report.');

const period = process.env.BEA_PERIOD_ID || '2026-07';
const fixturePath = resolve(root, 'ops/resolver/test/fixtures/bea-pio-2026-07.html');
const html = await readFile(fixturePath, 'utf8');
const parsed = parseCorePce(html, period);
const fixtureUrl = 'https://www.bea.gov/index.php/news/2026/personal-income-and-outlays-july-2026';
const { evidence, canonicalJson, evidenceHash } = makeEvidence({
  url: fixtureUrl,
  periodId: period,
  printedValue: parsed.printed,
  html,
  fetchedAt: new Date().toISOString(),
  fixtureMode: true,
});

let envText = '';
try { envText = await readFile(resolve(root, 'contracts/.env'), 'utf8'); } catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const i = line.indexOf('=');
  return i < 1 || line.trim().startsWith('#') ? [] : [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"](.*)['"]$/, '$1')]];
}));
const rpc = process.env.QT_TESTNET_RPC || env.RH_TESTNET_RPC || 'https://rpc.testnet.chain.robinhood.com';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc) });
if (await publicClient.getChainId() !== 46630) throw new Error('RPC is not Robinhood Chain Testnet; no transaction sent.');
const botEcdsaKey = process.env.QT_TESTNET_RESOLVER_ECDSA_PRIVATE_KEY || (await readFile(resolve(root, 'contracts/.secrets/testnet-bot-ecdsa.hex'), 'utf8')).trim();
const signer = privateKeyToAccount(botEcdsaKey.trim());
if (signer.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('Testnet resolver ECDSA key does not match the testnet manifest.');
const relayerKey = process.env.QT_TESTNET_RELAYER_PRIVATE_KEY || env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
if (!relayerKey) throw new Error('Set QT_TESTNET_RELAYER_PRIVATE_KEY or RH_TESTNET_DEPLOYER_PRIVATE_KEY.');
const relayer = privateKeyToAccount(relayerKey);
if (relayer.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error('Testnet relayer key does not match the testnet manifest deployer.');
const walletClient = createWalletClient({ account: relayer, chain, transport: http(rpc) });

const registryArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MarketRegistry.sol/MarketRegistry.json'), 'utf8'));
const adapterArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/ResolutionAdapter.sol/ResolutionAdapter.json'), 'utf8'));
const verifierArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8'));
const marketId = manifest.smokeMarket.marketId;
const market = await publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] });
if (market.periodId.toLowerCase() !== keccak256(stringToHex(period)).toLowerCase()) throw new Error('Testnet market period does not match the parsed BEA fixture.');
if (!market.activated) throw new Error('Testnet market is inactive.');
const priorOutcome = terminalOutcome(market.status);
if (priorOutcome) {
  if (Number(market.status) !== 4 && Number(market.status) !== 5) throw new Error(`Testnet market is already ${priorOutcome}; no report submitted.`);
  const [reportedValueBps, reportedEvidenceHash] = await Promise.all([
    publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
    publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
  ]);
  const expectedStatus = parsed.valueBps >= Number(market.thresholdBps) ? 4 : 5;
  if (Number(market.status) !== expectedStatus || Number(reportedValueBps) !== parsed.valueBps || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
    throw new Error('Final testnet market does not match the parsed fixture report.');
  }
  console.log(JSON.stringify({ chainId: 46630, marketId, period, alreadyFinal: true, finalStatus: priorOutcome, reportedValueBps: Number(reportedValueBps), evidenceHash: reportedEvidenceHash, newTransactionSent: false }, null, 2));
  process.exit(0);
}
const report = buildTestnetReport({ marketId, market, period, valueBps: parsed.valueBps, evidenceHash });
while (BigInt((await publicClient.getBlock()).timestamp) < market.releaseAt) await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
const domain = { name: 'QTimeline', version: '1', chainId: 46630, verifyingContract: manifest.addresses.ResolutionAdapter };
const types = { ReportValue: [
  { name: 'marketId', type: 'bytes32' }, { name: 'sourceId', type: 'bytes32' }, { name: 'periodId', type: 'bytes32' },
  { name: 'valueBps', type: 'int32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'signatureExpiry', type: 'uint64' },
] };
const message = { domain, types, primaryType: 'ReportValue', message: report };
const digest = hashTypedData(message);
const ecdsaSignature = await signer.signTypedData(message);
const pqPrivatePem = process.env.QT_TESTNET_RESOLVER_MLDSA_PRIVATE_KEY_PEM || await readFile(resolve(root, 'contracts/.secrets/testnet-bot-mldsa44.pem'), 'utf8');
const pqPrivateKey = createPrivateKey(pqPrivatePem);
const pqSignature = `0x${signMldsa(null, Buffer.from(digest.slice(2), 'hex'), pqPrivateKey).toString('hex')}`;
const pqKeyBlob = manifest.testnetKeys.bot.pkBlob;
const pqAccepted = await publicClient.readContract({ address: manifest.addresses.MLDSA44Verifier, abi: verifierArtifact.abi, functionName: 'verify', args: [pqKeyBlob, digest, pqSignature] });
if (!pqAccepted) throw new Error('Testnet ML-DSA verifier rejected the fixture report signature.');
const args = [report, stringToHex(canonicalJson), ecdsaSignature, pqSignature];
await publicClient.simulateContract({ account: relayer, address: manifest.addresses.ResolutionAdapter, abi: adapterArtifact.abi, functionName: 'reportValue', args });
const nonce = await publicClient.getTransactionCount({ address: relayer.address, blockTag: 'pending' });
const txHash = await walletClient.writeContract({ account: relayer, address: manifest.addresses.ResolutionAdapter, abi: adapterArtifact.abi, functionName: 'reportValue', args, gas: 25_000_000n, nonce });
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
if (receipt.status !== 'success') throw new Error(`Testnet report transaction reverted: ${txHash}`);
const [finalMarket, reportedValueBps, reportedEvidenceHash] = await Promise.all([
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] }),
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
  publicClient.readContract({ address: manifest.addresses.MarketRegistry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
]);
if (Number(finalMarket.status) !== 5 || Number(reportedValueBps) !== parsed.valueBps || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
  throw new Error('On-chain final status, value, or evidence hash did not match the parsed fixture.');
}

manifest.smokeMarket.mockBeaFixture = {
  period,
  printed: parsed.printed,
  valueBps: parsed.valueBps,
  expected: 'Final NO (20 bps is below the 30 bps threshold)',
  evidence,
  evidenceHash,
  transactionHash: txHash,
  blockNumber: receipt.blockNumber.toString(),
  finalStatus: 'Final NO',
  chainId: 46630,
  testnetOnly: true,
};
await import('node:fs/promises').then(({ writeFile }) => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`));
console.log(JSON.stringify({ chainId: 46630, marketId, period, printed: parsed.printed, valueBps: parsed.valueBps, mockFixture: evidence.fixtureMode, ecdsaSigner: signer.address, relayer: relayer.address, mldsaAccepted: pqAccepted, evidenceHash, transactionHash: txHash, blockNumber: receipt.blockNumber.toString(), finalStatus: 'Final NO' }, null, 2));
