import { createPrivateKey, sign as signMldsa } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, decodeErrorResult, defineChain, getAddress, hashTypedData, http, keccak256, recoverTypedDataAddress, toBytes, toHex } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-resolver-negative.json");
const expectedChainId = 46630;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

async function waitForReportWindow(client, releaseAt, deadline) {
  while (true) {
    const block = await client.getBlock();
    if (block.timestamp >= deadline) throw new Error("Market report deadline passed before negative resolver tests began");
    if (block.timestamp >= releaseAt) return block.timestamp;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
}

const adapterAbi = JSON.parse(await readFile(resolve(root, "contracts/out/ResolutionAdapter.sol/ResolutionAdapter.json"), "utf8")).abi;
const registryAbi = JSON.parse(await readFile(resolve(root, "contracts/out/MarketRegistry.sol/MarketRegistry.json"), "utf8")).abi;
const resolutionErrors = [...adapterAbi, ...registryAbi];
const types = { ReportValue: [
  { name: "marketId", type: "bytes32" }, { name: "sourceId", type: "bytes32" }, { name: "periodId", type: "bytes32" },
  { name: "valueBps", type: "int32" }, { name: "evidenceHash", type: "bytes32" }, { name: "signatureExpiry", type: "uint64" },
] };

async function expectRevert(client, request, expectedName) {
  try {
    await client.simulateContract(request);
  } catch (error) {
    for (const data of [error?.data, error?.cause?.data]) {
      if (typeof data !== "string") continue;
      try {
        const decoded = decodeErrorResult({ abi: resolutionErrors, data });
        if (decoded.errorName === expectedName) return { error: expectedName, selector: data.slice(0, 10) };
      } catch {}
    }
    const details = `${error?.shortMessage || ""} ${error?.message || ""}`;
    if (details.includes(expectedName)) return { error: expectedName, detail: details.slice(0, 240) };
    const expectedItem = resolutionErrors.find((item) => item.type === "error" && item.name === expectedName);
    if (expectedItem) {
      const signature = `${expectedItem.name}(${expectedItem.inputs.map((input) => input.type).join(",")})`;
      const selector = keccak256(toBytes(signature)).slice(0, 10).toLowerCase();
      if (details.toLowerCase().includes(selector)) return { error: expectedName, selector };
    }
    throw new Error(`Expected ${expectedName}, got ${(error?.shortMessage || error?.message || String(error)).slice(0, 500)}`);
  }
  throw new Error(`Expected ${expectedName}, but report simulation succeeded`);
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const smoke = manifest.smokeMarket;
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  if (manifest.chainId !== expectedChainId || !smoke?.activated) throw new Error("Expected an activated Robinhood testnet market");
  const account = privateKeyToAccount(env.RH_TESTNET_DEPLOYER_PRIVATE_KEY);
  const bot = privateKeyToAccount((await readFile(resolve(root, "contracts/.secrets/testnet-bot-ecdsa.hex"), "utf8")).trim());
  if (getAddress(manifest.deployer) !== getAddress(account.address) || getAddress(manifest.resolverSigner) !== getAddress(bot.address)) throw new Error("Manifest signer does not match testnet keys");
  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: expectedChainId, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== expectedChainId) throw new Error("Connected RPC is not Robinhood testnet 46630");
  const registry = getAddress(manifest.addresses.MarketRegistry);
  const adapter = getAddress(manifest.addresses.ResolutionAdapter);
  const market = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [smoke.marketId] });
  if (Number(market.status) > 3) throw new Error("Market is already terminal; create another short market for negative signature tests");
  const now = await waitForReportWindow(publicClient, market.releaseAt, market.deadline);

  const sourceId = keccak256(toBytes("bea:core-pce:mom:first-release"));
  const evidence = Buffer.from(JSON.stringify({ testnetOnly: true, question: "Will the test event happen within the next 5 minutes?", result: "YES", observedAt: Number(now), note: "Synthetic test evidence; not a real-world oracle observation." }));
  const evidenceJson = `0x${evidence.toString("hex")}`;
  const evidenceHash = keccak256(evidenceJson);
  const report = { marketId: smoke.marketId, sourceId, periodId: market.periodId, valueBps: 31, evidenceHash, signatureExpiry: market.deadline };
  const domain = { name: "QTimeline", version: "1", chainId: expectedChainId, verifyingContract: adapter };
  const requestFor = (value, ecdsa, pq) => ({ account, address: adapter, abi: adapterAbi, functionName: "reportValue", args: [value, evidenceJson, ecdsa, pq] });
  const signReport = async (value, reportDomain = domain) => {
    const digest = hashTypedData({ domain: reportDomain, types, primaryType: "ReportValue", message: value });
    const ecdsa = await bot.signTypedData({ domain: reportDomain, types, primaryType: "ReportValue", message: value });
    const pem = await readFile(resolve(root, "contracts/.secrets/testnet-bot-mldsa44.pem"), "utf8");
    const pq = `0x${signMldsa(null, Buffer.from(digest.slice(2), "hex"), createPrivateKey(pem)).toString("hex")}`;
    return { digest, ecdsa, pq };
  };
  const valid = await signReport(report);
  const recovered = await recoverTypedDataAddress({ domain, types, primaryType: "ReportValue", message: report, signature: valid.ecdsa });
  if (getAddress(recovered) !== getAddress(manifest.resolverSigner)) throw new Error("ECDSA test signature recovery mismatch");
  const outcomes = [];

  const deployerSignature = await account.signTypedData({ domain, types, primaryType: "ReportValue", message: report });
  outcomes.push({ case: "wrong ECDSA signer", ...(await expectRevert(publicClient, requestFor(report, deployerSignature, valid.pq), "InvalidSignature")) });

  const wrongPqDigest = keccak256(toBytes("wrong resolver digest"));
  const pem = await readFile(resolve(root, "contracts/.secrets/testnet-bot-mldsa44.pem"), "utf8");
  const wrongPq = `0x${signMldsa(null, Buffer.from(wrongPqDigest.slice(2), "hex"), createPrivateKey(pem)).toString("hex")}`;
  outcomes.push({ case: "wrong ML-DSA digest", ...(await expectRevert(publicClient, requestFor(report, valid.ecdsa, wrongPq), "InvalidSignature")) });

  const wrongDomain = { ...domain, chainId: 4663 };
  const wrongChainSigs = await signReport(report, wrongDomain);
  outcomes.push({ case: "wrong EIP-712 chain ID", ...(await expectRevert(publicClient, requestFor(report, wrongChainSigs.ecdsa, wrongChainSigs.pq), "InvalidSignature")) });

  const wrongPeriod = { ...report, periodId: `0x${"00".repeat(32)}` };
  outcomes.push({ case: "wrong report period", ...(await expectRevert(publicClient, requestFor(wrongPeriod, valid.ecdsa, valid.pq), "InvalidReport")) });

  const wrongEvidence = { ...report, evidenceHash: keccak256(toBytes("not the supplied evidence")) };
  outcomes.push({ case: "evidence hash mismatch", ...(await expectRevert(publicClient, requestFor(wrongEvidence, valid.ecdsa, valid.pq), "InvalidEvidence")) });

  const expiredReport = { ...report, signatureExpiry: now - 1n };
  outcomes.push({ case: "expired signature", ...(await expectRevert(publicClient, requestFor(expiredReport, "0x", "0x"), "Expired")) });

  await publicClient.simulateContract(requestFor(report, valid.ecdsa, valid.pq));
  const reportTx = await walletClient.writeContract(requestFor(report, valid.ecdsa, valid.pq));
  const receipt = await publicClient.waitForTransactionReceipt({ hash: reportTx, confirmations: 1 });
  if (receipt.status !== "success") throw new Error("Valid hybrid resolver report transaction reverted");
  const terminal = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [smoke.marketId] });
  if (Number(terminal.status) !== 4) throw new Error("Valid report did not finalize market YES");

  smoke.resolverNegativeSmoke = { testnetOnly: true, status: "Final YES", reportTransaction: reportTx, reportBlock: receipt.blockNumber.toString(), cases: outcomes, completedAt: new Date().toISOString() };
  smoke.status = "Final YES";
  smoke.resolution = { status: "Final YES", valueBps: 31, evidenceHash, reportTransaction: reportTx, blockNumber: receipt.blockNumber.toString(), testnetOnly: true };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  outcomes.push({ case: "duplicate report after terminal status", ...(await expectRevert(publicClient, requestFor(report, valid.ecdsa, valid.pq), "InvalidTransition")) });
  smoke.resolverNegativeSmoke.cases = outcomes;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(smoke.resolverNegativeSmoke, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
