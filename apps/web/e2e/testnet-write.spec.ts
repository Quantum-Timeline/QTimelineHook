import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = process.cwd();
const require = createRequire(resolve(repo, "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const manifestPath = process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-v2.json";
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

test("testnet UI buys, merges paired claims, and sells through the injected wallet", async ({ page }) => {
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

  const registryAbi = parseAbi(["function market(bytes32) view returns ((bytes32 configHash,address vault,address asset,uint64 opensAt,uint64 cutoffAt,uint64 releaseAt,uint64 deadline,bytes32 periodId,int32 thresholdBps,uint8 status,bool activated))"]);
  const market = await publicClient.readContract({
    address: manifest.addresses.MarketRegistry,
    abi: registryAbi,
    functionName: "market",
    args: [manifest.smokeMarket.marketId],
  });
  const block = await publicClient.getBlock();
  expect(market.activated).toBe(true);
  expect(Number(market.status)).toBe(2);
  expect(block.timestamp).toBeGreaterThanOrEqual(market.opensAt);
  expect(block.timestamp).toBeLessThan(market.cutoffAt);
  expect(await publicClient.getBalance({ address: account.address })).toBeGreaterThan(0n);
  const outcomeTokens = await publicClient.readContract({
    address: manifest.addresses.MarketFactory,
    abi: parseAbi(["function tokens(bytes32) view returns (address[4])"]),
    functionName: "tokens",
    args: [manifest.smokeMarket.marketId],
  });

  const walletClient = createWalletClient({ account, chain, transport: http(contractsEnv.RH_TESTNET_RPC) });
  const seedAmount = 1_000_000n;
  const erc20Abi = parseAbi(["function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"]);
  const currentAllowance = await publicClient.readContract({ address: market.asset, abi: erc20Abi, functionName: "allowance", args: [account.address, market.vault] });
  if (currentAllowance < seedAmount) {
    const approval = await walletClient.writeContract({ address: market.asset, abi: erc20Abi, functionName: "approve", args: [market.vault, seedAmount] });
    await publicClient.waitForTransactionReceipt({ hash: approval });
  }
  const splitHash = await walletClient.writeContract({
    address: market.vault,
    abi: parseAbi(["function split(address,uint256,address) payable"]),
    functionName: "split",
    args: [market.asset, seedAmount, account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: splitHash });

  await page.exposeBinding("qtWalletSendTransaction", async (_source, rawTransaction) => {
    const transaction = rawTransaction as Record<string, string | undefined>;
    expect(transaction.from?.toLowerCase()).toBe(account.address.toLowerCase());
    const destination = transaction.to?.toLowerCase();
    const allowedTargets = [market.asset, market.vault, manifest.addresses.TimelineRouter, ...outcomeTokens];
    expect(allowedTargets.map((address: string) => address.toLowerCase())).toContain(destination);
    const value = transaction.value ? BigInt(transaction.value) : 0n;
    expect(value).toBe(0n);
    return walletClient.sendTransaction({
      account,
      to: transaction.to,
      data: transaction.data,
      value,
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
        throw new Error(`Unexpected wallet request in testnet write test: ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    Object.defineProperty(window, "ethereum", { configurable: false, value: provider });
  }, { address: account.address });

  await page.goto(`/market/?id=${manifest.smokeMarket.marketId}`);
  await page.getByRole("button", { name: "Connect wallet to trade" }).click();
  await expect(page.locator(".quote-row strong")).not.toHaveText("—", { timeout: 30_000 });
  await page.getByRole("button", { name: /^Buy YES/ }).click();
  const tradeMessage = page.locator(".trade-message");
  await expect(tradeMessage).toContainText("Trade confirmed", { timeout: 90_000 });
  await page.waitForTimeout(1_000);
  await expect(tradeMessage).toContainText("Trade confirmed");
  await expect(tradeMessage.locator("a")).toHaveAttribute("href", /\/tx\//);

  await page.goto(`/positions/?id=${manifest.smokeMarket.marketId}`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).last().click();
  await expect(page.locator(".claim-card").first().locator("strong")).not.toHaveText("0", { timeout: 30_000 });
  const usdgYes = page.locator(".claim-card").nth(2).locator("strong");
  const usdgNo = page.locator(".claim-card").nth(3).locator("strong");
  const beforeYes = parseUnits(await usdgYes.innerText(), 6);
  const beforeNo = parseUnits(await usdgNo.innerText(), 6);
  expect(beforeYes).toBeGreaterThan(0n);
  expect(beforeNo).toBeGreaterThan(0n);
  await page.getByRole("button", { name: "Merge USDG" }).click();
  await expect(page.locator(".panel-message")).toContainText("Claims merged into collateral.", { timeout: 60_000 });
  await expect.poll(async () => parseUnits(await usdgYes.innerText(), 6)).toBeLessThan(beforeYes);
  await expect.poll(async () => parseUnits(await usdgNo.innerText(), 6)).toBeLessThan(beforeNo);

  const remainingYes = await page.locator(".claim-card").first().locator("strong").innerText();
  expect(parseUnits(remainingYes, 18)).toBeGreaterThan(0n);
  await page.goto(`/market/?id=${manifest.smokeMarket.marketId}`);
  await page.getByRole("button", { name: "Connect wallet to trade" }).click();
  await page.getByRole("button", { name: "Sell ETH" }).click();
  await page.locator(".amount-label input").fill(remainingYes);
  await expect(page.locator(".quote-row strong")).not.toHaveText("—", { timeout: 30_000 });
  await page.getByRole("button", { name: /^Sell YES/ }).click();
  await expect(page.locator(".trade-message")).toContainText("Trade confirmed", { timeout: 90_000 });
  await expect(page.locator(".trade-message a")).toHaveAttribute("href", /\/tx\//);
});
