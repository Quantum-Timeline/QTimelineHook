import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = process.cwd();
const require = createRequire(resolve(repo, "apps/web/package.json"));
const { createPublicClient, createWalletClient, defineChain, http, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const manifestPath = process.env.QTIMELINE_REDEEM_TESTNET_MANIFEST || "deployments/robinhood-testnet-ui-current.json";
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

test("positions UI redeems winning and zero-payout losing ETH and USDG claims through the injected wallet", async ({ page }) => {
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
  expect(market.activated).toBe(true);
  expect([4, 5]).toContain(Number(market.status));
  const factoryAbi = parseAbi(["function tokens(bytes32) view returns (address[4])"]);
  const tokens = await publicClient.readContract({ address: manifest.addresses.MarketFactory, abi: factoryAbi, functionName: "tokens", args: [manifest.smokeMarket.marketId] });
  const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
  const initialBalances = await Promise.all(tokens.map((address: string) => publicClient.readContract({ address, abi: tokenAbi, functionName: "balanceOf", args: [account.address] })));
  expect(initialBalances.some((balance: bigint) => balance > 0n)).toBe(true);

  const walletClient = createWalletClient({ account, chain, transport: http(contractsEnv.RH_TESTNET_RPC) });
  await page.exposeBinding("qtWalletSendTransaction", async (_source, rawTransaction) => {
    const transaction = rawTransaction as Record<string, string | undefined>;
    expect(transaction.from?.toLowerCase()).toBe(account.address.toLowerCase());
    expect(transaction.to?.toLowerCase()).toBe(market.vault.toLowerCase());
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
        throw new Error(`Unexpected wallet request in testnet redeem test: ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    Object.defineProperty(window, "ethereum", { configurable: false, value: provider });
  }, { address: account.address });

  await page.goto(`/positions/?id=${manifest.smokeMarket.marketId}`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).last().click();
  await expect(page.locator(".claim-card")).toHaveCount(4);
  const claims = [
    { index: 0, label: "Redeem ETH YES" },
    { index: 1, label: "Redeem ETH NO" },
    { index: 2, label: "Redeem USDG YES" },
    { index: 3, label: "Redeem USDG NO" },
  ];
  for (const claim of claims) {
    if (initialBalances[claim.index] === 0n) continue;
    await page.getByRole("button", { name: claim.label }).click();
    await expect(page.locator(".panel-message")).toContainText("Claim redeemed.", { timeout: 60_000 });
    await expect(page.locator(".claim-card").nth(claim.index).locator("strong")).toHaveText("0", { timeout: 30_000 });
  }
});
