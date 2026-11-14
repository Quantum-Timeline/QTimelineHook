import https from "node:https";
import { Resolver } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const { createPublicClient, createWalletClient, custom, defineChain, getAddress, keccak256, toBytes, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const root = process.cwd();
const chainIdExpected = 46630;
const votingAddress = "0xEc2c8735956017eFF923CE882652866Ea3D1eBF3";
const depositAmount = 1_000_000_000_000_000_000n;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    return at < 1 ? [] : [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

function makeTransport(rpcUrl, overrideIp) {
  const url = new URL(rpcUrl);
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let ip = overrideIp;
  return custom({ request: async ({ method, params }) => {
    if (!ip) ip = (await resolver.resolve4(url.hostname))[0];
    if (!ip) throw new Error("Official testnet RPC hostname has no independent DNS answer");
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] });
    return new Promise((resolvePromise, reject) => {
      const req = https.request({ hostname: ip, servername: url.hostname, port: Number(url.port || 443), path: `${url.pathname}${url.search}`, method: "POST", headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, rejectUnauthorized: true }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(text);
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`RPC HTTP status ${res.statusCode}`));
            if (json.error) return reject(new Error(`RPC ${json.error.code}: ${json.error.message}`));
            resolvePromise(json.result);
          } catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("RPC request timed out")));
      req.end(body);
    });
  } });
}

const votingAbi = parseAbi([
  "function tokenBound() view returns (bool)", "function qtl() view returns (address)", "function nextElectionId() view returns (uint256)",
  "function elections(uint256) view returns (bytes32 candidateA,bytes32 candidateB,uint64 depositStart,uint64 voteStart,uint64 voteEnd,uint64 withdrawAfter,uint256 totalEscrow,uint256 votesA,uint256 votesB,uint8 winner,bool finalized)",
  "function escrowed(uint256,address) view returns (uint256)", "function hasVoted(uint256,address) view returns (bool)",
  "function bindToken(address)", "function configureElection(bytes32,bytes32,uint64,uint64,uint64,uint64) returns (uint256)",
  "function deposit(uint256,uint256)", "function vote(uint256,uint8)", "function finalizeElection(uint256)", "function withdraw(uint256)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function mint(address,uint256)"]);

try {
  const manifestPath = resolve(root, process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-v2.json");
  const env = parseEnv(await readFile(resolve(root, "contracts/.env"), "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Missing testnet deployer key in contracts/.env");
  const account = privateKeyToAccount(privateKey);
  if (manifest.chainId !== chainIdExpected || getAddress(manifest.deployer) !== getAddress(account.address)) throw new Error("Manifest/deployer mismatch; refusing to sign");

  const rpcUrl = env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  const chain = defineChain({ id: chainIdExpected, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const transport = makeTransport(rpcUrl, env.RH_TESTNET_RPC_IP);
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if (await client.getChainId() !== chainIdExpected) throw new Error("Only Robinhood testnet chain ID 46630 is allowed");

  const voting = getAddress(manifest.addresses.QTLVoting || votingAddress);
  const mockArtifact = JSON.parse(await readFile(resolve(root, "contracts/out/QTLVoting.t.sol/MockQTL.json"), "utf8"));
  const deployment = manifest.testnetVoting ?? { candidateA: keccak256(toBytes("QTimeline testnet threshold A")), candidateB: keccak256(toBytes("QTimeline testnet threshold B")), transactions: {} };
  deployment.transactions ??= {};
  const save = async () => { manifest.testnetVoting = deployment; await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); };
  if (deployment.complete) {
    console.log(`Voting smoke already complete for election ${deployment.electionId}; manifest ${manifestPath} retains the confirmed receipts.`);
    process.exit(0);
  }
  const send = async (step, request) => {
    await client.simulateContract({ account, ...request });
    const hash = await wallet.writeContract({ account, ...request });
    console.log(`${step}: ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`${step} reverted`);
    deployment.transactions[step] = hash;
    await save();
    return hash;
  };

  let bound = await client.readContract({ address: voting, abi: votingAbi, functionName: "tokenBound" });
  let token = deployment.token;
  if (!bound) {
    if (token) throw new Error("Manifest has a test QTL token but the voting contract is not bound");
    const hash = await wallet.deployContract({ account, abi: mockArtifact.abi, bytecode: mockArtifact.bytecode.object });
    console.log(`Deploy test-only QTL token: ${hash}`);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Test QTL token deployment failed");
    token = getAddress(receipt.contractAddress);
    deployment.token = token;
    deployment.transactions.deployToken = hash;
    await save();
    await send("bindToken", { address: voting, abi: votingAbi, functionName: "bindToken", args: [token] });
    bound = true;
  }
  if (!token) token = getAddress(await client.readContract({ address: voting, abi: votingAbi, functionName: "qtl" }));
  if (getAddress(await client.readContract({ address: voting, abi: votingAbi, functionName: "qtl" })) !== getAddress(token)) throw new Error("Voting token does not match testnet manifest");
  deployment.token = getAddress(token);
  deployment.tokenSymbol = "QTL";
  const tokenBalance = await client.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
  if (tokenBalance < depositAmount) await send("mintTestQtl", { address: token, abi: tokenAbi, functionName: "mint", args: [account.address, depositAmount] });

  let nextId = await client.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" });
  if (deployment.electionId === undefined) {
    if (nextId !== 0n) throw new Error("Voting contract already has an unrecorded election");
    const block = await client.getBlock();
    const depositStart = block.timestamp + 15n;
    const voteStart = depositStart + 45n;
    const voteEnd = voteStart + 30n;
    deployment.times = { depositStart: depositStart.toString(), voteStart: voteStart.toString(), voteEnd: voteEnd.toString(), withdrawAfter: voteEnd.toString() };
    await save();
    const before = nextId;
    await send("configureElection", { address: voting, abi: votingAbi, functionName: "configureElection", args: [deployment.candidateA, deployment.candidateB, depositStart, voteStart, voteEnd, voteEnd] });
    nextId = await client.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" });
    if (nextId !== before + 1n) throw new Error("Election ID did not increment");
    deployment.electionId = before.toString();
    await save();
  }
  const electionId = BigInt(deployment.electionId);
  const election = await client.readContract({ address: voting, abi: votingAbi, functionName: "elections", args: [electionId] });
  if (election[0] !== deployment.candidateA || election[1] !== deployment.candidateB) throw new Error("Voting election candidates do not match manifest");
  const waitUntil = async (target) => {
    let block = await client.getBlock();
    while (block.timestamp < target) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
      block = await client.getBlock();
    }
    return block;
  };
  let escrow = 0n;
  await waitUntil(BigInt(election[2]));
  escrow = await client.readContract({ address: voting, abi: votingAbi, functionName: "escrowed", args: [electionId, account.address] });
  if (escrow < depositAmount) {
    const allowance = await client.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [account.address, voting] });
    if (allowance < depositAmount) await send("approveVoting", { address: token, abi: tokenAbi, functionName: "approve", args: [voting, depositAmount] });
    await send("deposit", { address: voting, abi: votingAbi, functionName: "deposit", args: [electionId, depositAmount] });
    escrow = await client.readContract({ address: voting, abi: votingAbi, functionName: "escrowed", args: [electionId, account.address] });
  }
  if (escrow !== depositAmount) throw new Error("Unexpected voting escrow amount");
  await waitUntil(BigInt(election[3]));
  const hasVoted = await client.readContract({ address: voting, abi: votingAbi, functionName: "hasVoted", args: [electionId, account.address] });
  if (!hasVoted) await send("voteA", { address: voting, abi: votingAbi, functionName: "vote", args: [electionId, 0] });
  await waitUntil(BigInt(election[4]));
  if (!election[10]) await send("finalizeElection", { address: voting, abi: votingAbi, functionName: "finalizeElection", args: [electionId] });
  escrow = await client.readContract({ address: voting, abi: votingAbi, functionName: "escrowed", args: [electionId, account.address] });
  if (escrow > 0n) await send("withdraw", { address: voting, abi: votingAbi, functionName: "withdraw", args: [electionId] });
  const final = await client.readContract({ address: voting, abi: votingAbi, functionName: "elections", args: [electionId] });
  const remaining = await client.readContract({ address: voting, abi: votingAbi, functionName: "escrowed", args: [electionId, account.address] });
  if (!final[10] || final[9] !== 0 || final[7] !== depositAmount || remaining !== 0n) throw new Error("Voting testnet smoke state failed its final checks");
  deployment.complete = true;
  await save();
  console.log(`Voting testnet smoke complete: election ${electionId}, candidate A won with 1 QTL, escrow returned.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
