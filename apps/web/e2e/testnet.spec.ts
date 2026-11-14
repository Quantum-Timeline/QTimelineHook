import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifestPath = process.env.QTIMELINE_TESTNET_MANIFEST || "deployments/robinhood-testnet-v2.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.chainId !== 46630) throw new Error("Browser smoke tests require a Robinhood Testnet manifest");
const marketId: string = manifest.smokeMarket.marketId;
const question = "Dalam 5 menit ke depan, gue berak gak?";
const testAccount = manifest.deployer as `0x${string}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ address }) => {
    const provider = {
      isMetaMask: true,
      selectedAddress: address,
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0xb626";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
        if (method === "wallet_switchEthereumChain") return null;
        throw new Error(`Unexpected wallet request in read-only browser test: ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    Object.defineProperty(window, "ethereum", { configurable: false, value: provider });
  }, { address: testAccount });
});

test("market page reads the active synthetic event and a real Uniswap v4 quote", async ({ page }) => {
  await page.goto(`/market/?id=${marketId}`);
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  await expect(page.getByText("Market is inside its on-chain trading window.", { exact: true })).toBeVisible();
  await expect(page.locator(".chain-snapshot strong").first()).toHaveText("Open");

  await page.getByRole("button", { name: "Connect wallet to trade" }).click();
  await expect(page.locator(".quote-row strong").first()).not.toHaveText("—", { timeout: 30_000 });
  await expect(page.locator(".trade-message")).toBeEmpty();
});

test("positions page reads all four outcome balances for the configured testnet market", async ({ page }) => {
  await page.goto(`/positions/?id=${marketId}`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).last().click();
  await expect(page.locator(".claim-card")).toHaveCount(4);
  await expect(page.locator(".panel-head h2")).toContainText("Market · Open");
});

test("voting page reads the finalized test QTL election", async ({ page }) => {
  await page.goto("/vote/");
  await expect(page.getByRole("heading", { name: "Election #0" })).toBeVisible();
  await expect(page.getByText("Election finalized. Winner:", { exact: false })).toBeVisible();
  await expect(page.getByText("Vote A")).toBeDisabled();
});

test("product routes use the landing page's dark canvas and Archivo display face", async ({ page }) => {
  await page.goto("/");
  const landingStyle = await page.locator(".qt-erestyra").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    displayFace: getComputedStyle(element.querySelector("h1")!).fontFamily,
  }));
  await page.goto("/market/");
  const productStyle = await page.locator("main.shell").evaluate((element) => ({
    displayFace: getComputedStyle(element.querySelector("h1")!).fontFamily,
  }));
  const productCanvas = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(productCanvas).toBe(landingStyle.background);
  expect(productStyle.displayFace).toContain("Archivo");
  expect(landingStyle.displayFace).toContain("Archivo");
});

test("landing and product routes fit a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", `/market/?id=${marketId}`, `/positions/?id=${marketId}`, "/vote/", "/bea-proof/"]) {
    await page.goto(route);
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(widths.content, `${route} should fit the mobile viewport`).toBeLessThanOrEqual(widths.viewport);
  }
});
