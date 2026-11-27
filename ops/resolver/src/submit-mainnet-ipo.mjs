// Anthropic IPO pricing resolver. A separate system from Core PCE: it reads the SEC final prospectus (424B4), signs the offering price
// in US cents with its own bot keys, and submits to the IPO adapter. Simulation is the default; QT_BROADCAST=1 sends the report.
import { createPrivateKey, sign as signMldsa } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ANTHROPIC_CIK, documentUrl, fetchProspectus, fetchSubmissions, findFirstFinalProspectus, makeIpoEvidence, parseOfferPrice } from './sec.mjs';
import { assertIpoManifest, buildIpoReport } from './ipo-report.mjs';
import { SOURCE_ID as BEA_SOURCE_ID, fetchOfficialRelease, makeEvidence as makeBeaEvidence, officialReleaseUrl, parseCorePce } from './bea.mjs';
import { RELEASE_URL as BLS_RELEASE_URL, SOURCE_ID as BLS_SOURCE_ID, fetchOfficialRelease as fetchBlsRelease, makeEvidence as makeBlsEvidence, parseUnemploymentRate } from './bls.mjs';
import { terminalOutcome } from './mainnet-report.mjs';
import { normalizeMainnetSeedHex } from './mainnet-seed.mjs';

const root = resolve(import.meta.dirname, '../../..');
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || 'deployments/robinhood-mainnet-ipo.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertIpoManifest(manifest);

const period = process.env.QT_IPO_PERIOD || 'ANT-IPO-PRICE-2026-11';

const marketId = process.env.QT_IPO_MARKET_ID || manifest.ipoMarket?.marketId;
if (!marketId || !/^0x[0-9a-fA-F]{64}$/.test(marketId)) throw new Error('Set QT_IPO_MARKET_ID after the IPO market is created.');

// One resolver, several sources. QT_EVENT_SOURCE picks how the value is read: 'sec' (default, the original IPO price from the 424B4)
// or 'bea' (US Core PCE month over month from the BEA release for QT_BEA_DATA_PERIOD, for example 2026-10). The market must be
// bound to the same source on chain (IpoResolutionAdapter.setMarketSource); the check below refuses to sign otherwise.
const eventSource = process.env.QT_EVENT_SOURCE || 'sec';
if (eventSource !== 'sec' && eventSource !== 'bea' && eventSource !== 'bls') throw new Error("QT_EVENT_SOURCE must be 'sec', 'bea' or 'bls'.");

let first;
let fetched;
let parsed;
let beaEvidence;
if (eventSource === 'bls') {
  // US unemployment rate (total, seasonally adjusted) from BLS Employment Situation Table A-1 for QT_BLS_DATA_PERIOD (for example
  // 2026-11), in basis points: 4.2% is 420. Same rehearsal seam as BEA, honoured only against a local fork RPC.
  const dataPeriod = process.env.QT_BLS_DATA_PERIOD;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(dataPeriod ?? '')) throw new Error('Set QT_BLS_DATA_PERIOD to the data month, for example 2026-11.');
  let release;
  if (process.env.QT_EVENT_REHEARSAL_HTML) {
    const host = new URL(process.env.QT_MAINNET_RPC || 'http://invalid.invalid').hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Rehearsal fixtures are only allowed against a local fork RPC.');
    release = { published: true, url: BLS_RELEASE_URL, html: await readFile(process.env.QT_EVENT_REHEARSAL_HTML, 'utf8') };
  } else {
    release = await fetchBlsRelease(process.env.QT_BLS_USER_AGENT);
  }
  const bls = release.published ? parseUnemploymentRate(release.html, dataPeriod) : { pending: true };
  if (bls.pending) {
    console.log(JSON.stringify({ chainId: 4663, period, published: false, reason: `BLS release for ${dataPeriod} is not published yet`, transactionSent: false }));
    process.exit(0);
  }
  parsed = { printed: bls.printed, priceCents: bls.valueBps };
  beaEvidence = makeBlsEvidence({ url: release.url, periodId: dataPeriod, printedValue: bls.printed, html: release.html, fetchedAt: new Date().toISOString() });
} else if (eventSource === 'bea') {
  const dataPeriod = process.env.QT_BEA_DATA_PERIOD;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(dataPeriod ?? '')) throw new Error('Set QT_BEA_DATA_PERIOD to the data month, for example 2026-10.');
  let release;
  if (process.env.QT_EVENT_REHEARSAL_HTML) {
    // Rehearsal seam: replays a saved real BEA page through the production signing and submission path. Honoured only against a
    // local fork RPC, so it can never change what a real run reads from BEA.
    const host = new URL(process.env.QT_MAINNET_RPC || 'http://invalid.invalid').hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Rehearsal fixtures are only allowed against a local fork RPC.');
    release = { published: true, url: officialReleaseUrl(dataPeriod), html: await readFile(process.env.QT_EVENT_REHEARSAL_HTML, 'utf8') };
  } else {
    release = await fetchOfficialRelease(officialReleaseUrl(dataPeriod));
  }
  if (!release.published) {
    console.log(JSON.stringify({ chainId: 4663, period, published: false, reason: `BEA release for ${dataPeriod} is not published yet`, transactionSent: false }));
    process.exit(0);
  }
  const bea = parseCorePce(release.html, dataPeriod);
  parsed = { printed: bea.printed, priceCents: bea.valueBps };
  beaEvidence = makeBeaEvidence({ url: release.url, periodId: dataPeriod, printedValue: bea.printed, html: release.html, fetchedAt: new Date().toISOString() });
} else if (process.env.QT_IPO_REHEARSAL === '1') {
  // Rehearsal seam: replays a saved real 424B4 through the exact production signing and submission path.
  // It is honoured only against a local fork, so it can never change what a real run reads from the SEC.
  const host = new URL(process.env.QT_MAINNET_RPC || 'http://invalid.invalid').hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Rehearsal fixtures are only allowed against a local fork RPC.');
  const html = await readFile(process.env.QT_IPO_REHEARSAL_PROSPECTUS, 'utf8');
  first = { accession: '0001193125-25-135795', filingDate: '2025-06-05', acceptedAt: '2025-06-05T20:00:00.000Z', primaryDocument: 'd737521d424b4.htm' };
  fetched = { url: 'https://www.sec.gov/Archives/edgar/data/1876042/000119312525135795/d737521d424b4.htm', text: html };
  parsed = parseOfferPrice(html, { company: /circle internet group/i });
} else {
  // Poll the SEC. Until a final prospectus (424B4) exists there is nothing to report, which is a normal result.
  const submissions = await fetchSubmissions(ANTHROPIC_CIK);
  first = findFirstFinalProspectus(submissions);
  if (!first) {
    console.log(JSON.stringify({ chainId: 4663, period, published: false, reason: 'no 424B4 on EDGAR yet', transactionSent: false }));
    process.exit(0);
  }
  fetched = await fetchProspectus(documentUrl({ cik: ANTHROPIC_CIK, accession: first.accession, primaryDocument: first.primaryDocument }));
  parsed = parseOfferPrice(fetched.text);
}
const { evidence, canonicalJson, evidenceHash } = beaEvidence ?? makeIpoEvidence({
  url: fetched.url,
  accession: first.accession,
  filingDate: first.filingDate,
  acceptedAt: first.acceptedAt,
  printed: parsed.printed,
  priceCents: parsed.priceCents,
  html: fetched.text,
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

let resolverKey = process.env.QT_IPO_RESOLVER_ECDSA_PRIVATE_KEY;
if (!resolverKey) resolverKey = (await readFile(resolve(root, 'contracts/.secrets/mainnet-ipo-bot-ecdsa.hex'), 'utf8')).trim();
const signer = privateKeyToAccount(resolverKey.trim());
if (signer.address.toLowerCase() !== manifest.resolverSigner.toLowerCase()) throw new Error('IPO resolver ECDSA key does not match the deployment manifest.');

let relayerKey = process.env.QT_MAINNET_RELAYER_PRIVATE_KEY;
if (!relayerKey) relayerKey = localEnv.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
if (!relayerKey) throw new Error('Set QT_MAINNET_RELAYER_PRIVATE_KEY or RH_MAINNET_DEPLOYER_PRIVATE_KEY.');
const relayer = privateKeyToAccount(relayerKey.trim());
const expectedRelayer = process.env.QT_MAINNET_RELAYER_ADDRESS || localEnv.RH_MAINNET_DEPLOYER_ADDRESS;
if (expectedRelayer && relayer.address.toLowerCase() !== expectedRelayer.toLowerCase()) throw new Error('Mainnet relayer key does not match its configured address.');
if (relayer.address.toLowerCase() === signer.address.toLowerCase()) throw new Error('Mainnet report relayer and resolver signer must be separate wallets.');

const registryArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/IpoMarketRegistry.sol/IpoMarketRegistry.json'), 'utf8'));
const adapterArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/IpoResolutionAdapter.sol/IpoResolutionAdapter.json'), 'utf8'));
const verifierArtifact = JSON.parse(await readFile(resolve(root, 'contracts/out/MLDSA44Verifier.sol/MLDSA44Verifier.json'), 'utf8'));
const registry = manifest.addresses.IpoMarketRegistry;
const adapter = manifest.addresses.IpoResolutionAdapter;
const resolverAbi = [{ type: 'function', name: 'authorizedSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }];
const onchainSigner = await publicClient.readContract({ address: adapter, abi: resolverAbi, functionName: 'authorizedSigner' });
if (onchainSigner.toLowerCase() !== signer.address.toLowerCase()) throw new Error('ECDSA signer does not match the IPO adapter authorization.');

const market = await publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] });
if (market.periodId.toLowerCase() !== keccak256(stringToHex(period)).toLowerCase()) throw new Error('On-chain IPO market period does not match the configured period.');
const sourceIdText = eventSource === 'bea' ? BEA_SOURCE_ID : eventSource === 'bls' ? BLS_SOURCE_ID : undefined;
const expectedSourceAbi = [{ type: 'function', name: 'expectedSource', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes32' }] }];
if (sourceIdText) {
  // The adapter only settles a market from the source it was bound to; refuse early (and clearly) if the binding is missing.
  const bound = await publicClient.readContract({ address: adapter, abi: expectedSourceAbi, functionName: 'expectedSource', args: [marketId] });
  if (bound.toLowerCase() !== keccak256(stringToHex(sourceIdText)).toLowerCase()) throw new Error(`Market is not bound to the ${eventSource.toUpperCase()} source on chain; run setMarketSource first. No transaction sent.`);
}
const priorOutcome = terminalOutcome(market.status);
if (priorOutcome) {
  const result = { chainId: 4663, marketId, period, published: true, alreadyFinal: true, finalStatus: priorOutcome, newTransactionSent: false };
  if (Number(market.status) === 4 || Number(market.status) === 5) {
    const [reportedValueBps, reportedEvidenceHash] = await Promise.all([
      publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
      publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
    ]);
    const expectedStatus = parsed.priceCents >= Number(market.thresholdBps) ? 4 : 5;
    if (Number(market.status) !== expectedStatus || Number(reportedValueBps) !== parsed.priceCents || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
      throw new Error('Final IPO market does not match the SEC final prospectus.');
    }
    result.reportedValueBps = Number(reportedValueBps);
    result.reportedEvidenceHash = reportedEvidenceHash;
  }
  await writeResult(root, { ...result, currentSourcePriceCents: parsed.priceCents, evidence, canonicalEvidence: canonicalJson, evidenceHash });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
if (!market.activated) throw new Error('IPO market is not activated.');
const report = buildIpoReport({ marketId, market, period, priceCents: parsed.priceCents, evidenceHash, sourceIdText, allowNonPositive: eventSource !== 'sec' });
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
let seedHex = process.env.QT_IPO_RESOLVER_MLDSA_SEED_HEX;
if (!seedHex) seedHex = await readFile(resolve(root, 'contracts/.secrets/mainnet-ipo-bot-mldsa44.seed'));
seedHex = normalizeMainnetSeedHex(seedHex);
const pqPrivateKey = createPrivateKey({ key: Buffer.from(seedHex, 'hex'), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-44' });
const pqSignature = `0x${signMldsa(null, Buffer.from(digest.slice(2), 'hex'), pqPrivateKey).toString('hex')}`;
const pqKeyBlob = manifest.keyValidation?.bot?.pkBlob || manifest.deployments?.botPKBlob?.address;
const pqAccepted = await publicClient.readContract({ address: manifest.addresses.MLDSA44Verifier, abi: verifierArtifact.abi, functionName: 'verify', args: [pqKeyBlob, digest, pqSignature] });
if (!pqAccepted) throw new Error('IPO ML-DSA verifier rejected the resolver signature.');

const args = [report, stringToHex(canonicalJson), ecdsaSignature, pqSignature];
const simulation = await publicClient.simulateContract({ account: relayer, address: adapter, abi: adapterArtifact.abi, functionName: 'reportValue', args });
const result = { chainId: 4663, marketId, period, printed: parsed.printed, priceCents: parsed.priceCents, thresholdCents: Number(market.thresholdBps), ecdsaSigner: signer.address, relayer: relayer.address, mldsaAccepted: pqAccepted, evidence, canonicalEvidence: canonicalJson, evidenceHash, simulated: true, transactionSent: false };
if (process.env.QT_BROADCAST !== '1') {
  await writeResult(root, result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const walletClient = createWalletClient({ account: relayer, chain, transport: http(rpc) });
const nonce = await publicClient.getTransactionCount({ address: relayer.address, blockTag: 'pending' });
const txHash = await walletClient.writeContract({ ...simulation.request, nonce });
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
if (receipt.status !== 'success') throw new Error(`IPO resolver transaction reverted: ${txHash}`);
const [finalMarket, reportedValueBps, reportedEvidenceHash] = await Promise.all([
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'market', args: [marketId] }),
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'reportedValueBps', args: [marketId] }),
  publicClient.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'evidenceHash', args: [marketId] }),
]);
const expectedStatus = parsed.priceCents >= Number(market.thresholdBps) ? 4 : 5;
if (Number(finalMarket.status) !== expectedStatus || Number(reportedValueBps) !== parsed.priceCents || reportedEvidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
  throw new Error('On-chain IPO final status, price, or evidence hash did not match the SEC final prospectus.');
}
const finalResult = { ...result, simulated: true, transactionSent: true, transactionHash: txHash, blockNumber: receipt.blockNumber.toString(), finalStatus: terminalOutcome(finalMarket.status) };
await writeResult(root, finalResult);
console.log(JSON.stringify(finalResult, null, 2));

async function writeResult(base, data) {
  const output = resolve(base, process.env.QT_IPO_RESULT_PATH || 'resolver-result-ipo.json');
  await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
}
