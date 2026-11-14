import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = process.cwd();
const require = createRequire(resolve(repo, "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const manifestPath = process.env.QTIMELINE_VOTE_TESTNET_MANIFEST || "deployments/robinhood-testnet-v2.json";
const manifest = JSON.parse(readFileSync(resolve(repo, manifestPath), "utf8"));

function readContractsEnv() {
  return Object.fromEntries(readFileSync(resolve(repo, "contracts/.env"), "utf8").split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    return separator < 1 ? [] : [[trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

test.skip(process.env.QTIMELINE_ALLOW_TESTNET_WRITES !== "YES", "Set QTIMELINE_ALLOW_TESTNET_WRITES=YES to enable testnet wallet writes");

test("vote UI deposits, votes, finalizes, and withdraws on Robinhood Testnet", async ({ page }) => {
  test.setTimeout(480_000);
  expect(manifest.chainId).toBe(46630);
  const contractsEnv = readContractsEnv();
  const account = privateKeyToAccount(contractsEnv.RH_TESTNET_DEPLOYER_PRIVATE_KEY);
  expect(account.address.toLowerCase()).toBe(manifest.deployer.toLowerCase());
  const chain = defineChain({
    id: 46630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [contractsEnv.RH_TESTNET_RPC] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(contractsEnv.RH_TESTNET_RPC) });
  expect(await publicClient.getChainId()).toBe(46630);

  const voting = manifest.addresses.QTLVoting;
  const token = manifest.testnetVoting.token;
  const candidateA = manifest.testnetVoting.candidateA;
  const candidateB = manifest.testnetVoting.candidateB;
  const votingAbi = parseAbi([
    "function nextElectionId() view returns(uint256)",
    "function configureElection(bytes32,bytes32,uint64,uint64,uint64,uint64) returns(uint256)",
    "function elections(uint256) view returns(bytes32,bytes32,uint64,uint64,uint64,uint64,uint256,uint256,uint256,uint8,bool)",
  ]);
  const tokenAbi = parseAbi([
    "function balanceOf(address) view returns(uint256)",
    "function mint(address,uint256)",
  ]);
  const walletClient = createWalletClient({ account, chain, transport: http(contractsEnv.RH_TESTNET_RPC) });
  const depositAmount = parseUnits("1", 18);
  if (await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }) < depositAmount) {
    const mint = await walletClient.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [account.address, depositAmount] });
    await publicClient.waitForTransactionReceipt({ hash: mint });
  }

  const nextElectionId = await publicClient.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" });
  const block = await publicClient.getBlock();
  let electionId = nextElectionId;
  let depositStart: bigint;
  let voteStart: bigint;
  let voteEnd: bigint;
  if (nextElectionId > 0n) {
    const previous = await publicClient.readContract({ address: voting, abi: votingAbi, functionName: "elections", args: [nextElectionId - 1n] });
    if (!previous[10]) {
      expect(previous[0]).toBe(candidateA);
      expect(previous[1]).toBe(candidateB);
      electionId = nextElectionId - 1n;
      depositStart = previous[2];
      voteStart = previous[3];
      voteEnd = previous[4];
    } else {
      depositStart = block.timestamp + 30n;
      voteStart = depositStart + 180n;
      voteEnd = voteStart + 120n;
      const configured = await walletClient.writeContract({ address: voting, abi: votingAbi, functionName: "configureElection", args: [candidateA, candidateB, depositStart, voteStart, voteEnd, voteEnd] });
      await publicClient.waitForTransactionReceipt({ hash: configured });
      expect(await publicClient.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" })).toBe(nextElectionId + 1n);
    }
  } else {
    depositStart = block.timestamp + 30n;
    voteStart = depositStart + 180n;
    voteEnd = voteStart + 120n;
    const configured = await walletClient.writeContract({ address: voting, abi: votingAbi, functionName: "configureElection", args: [candidateA, candidateB, depositStart, voteStart, voteEnd, voteEnd] });
    await publicClient.waitForTransactionReceipt({ hash: configured });
    expect(await publicClient.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" })).toBe(nextElectionId + 1n);
  }
  expect(electionId).toBe(BigInt(process.env.NEXT_PUBLIC_ELECTION_ID || "0"));

  const waitUntil = async (timestamp: bigint) => {
    while ((await publicClient.getBlock()).timestamp < timestamp) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  };
  const allowedTargets = [voting, token].map((address: string) => address.toLowerCase());
  await page.exposeBinding("qtWalletSendTransaction", async (_source, rawTransaction) => {
    const transaction = rawTransaction as Record<string, string | undefined>;
    expect(transaction.from?.toLowerCase()).toBe(account.address.toLowerCase());
    expect(allowedTargets).toContain(transaction.to?.toLowerCase());
    expect(transaction.value ? BigInt(transaction.value) : 0n).toBe(0n);
    return walletClient.sendTransaction({
      account,
      to: transaction.to,
      data: transaction.data,
      value: 0n,
      gas: transaction.gas ? BigInt(transaction.gas) : undefined,
      nonce: transaction.nonce ? Number(BigInt(transaction.nonce)) : undefined,
      gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
      maxFeePerGas: transaction.maxFeePerGas ? BigInt(transaction.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? BigInt(transaction.maxPriorityFeePerGas) : undefined,
    });
  });
  await page.addInitScript(({ address }) => {
    const provider = {
      isMetaMask: true,
      selectedAddress: address,
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        if (method === "eth_chainId") return "0xb626";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_sendTransaction") {
          return (window as unknown as Window & { qtWalletSendTransaction: (transaction: unknown) => Promise<string> }).qtWalletSendTransaction(params[0]);
        }
        throw new Error(`Unexpected wallet request in testnet vote test: ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    Object.defineProperty(window, "ethereum", { configurable: false, value: provider });
  }, { address: account.address });

  await page.goto("/vote/");
  await page.locator(".chain-panel").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await waitUntil(depositStart);
  await page.getByRole("button", { name: "Refresh election" }).click();
  await page.getByLabel("QTL amount to escrow").fill("1");
  await page.getByRole("button", { name: "Approve & deposit QTL" }).click();
  await expect(page.locator(".detail-row").filter({ hasText: "YOUR ESCROW" })).toContainText("1 QTL", { timeout: 60_000 });

  await waitUntil(voteStart);
  await page.getByRole("button", { name: "Refresh election" }).click();
  await page.getByRole("button", { name: "Vote A" }).click();
  await expect(page.locator(".detail-row").filter({ hasText: "YOUR ESCROW" })).toContainText("voted", { timeout: 60_000 });

  await waitUntil(voteEnd);
  await page.getByRole("button", { name: "Refresh election" }).click();
  await page.getByRole("button", { name: "Finalize election" }).click();
  await expect(page.getByText("Election finalized. Winner:", { exact: false })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Withdraw QTL" }).click();
  await expect(page.locator(".detail-row").filter({ hasText: "YOUR ESCROW" })).toContainText("0 QTL", { timeout: 60_000 });
});
