import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifestPath = process.env.QTIMELINE_BEA_TESTNET_MANIFEST || "deployments/robinhood-testnet-bea-mock.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const marketId: string = manifest.smokeMarket.marketId;
const report = manifest.smokeMarket.mockBeaFixture;
if (manifest.chainId !== 46630 || report?.testnetOnly !== true) throw new Error("BEA fixture UI check requires its testnet-only proof manifest");

test("BEA proof page displays the on-chain fixture result and evidence hash", async ({ page }) => {
  await page.goto("/bea-proof/");
  await expect(page.getByRole("heading", { name: "BEA fixture, on chain." })).toBeVisible();
  await expect(page.getByText("Archived BEA HTML fixture · mock run, not a live result.", { exact: true })).toBeVisible();
  await expect(page.locator(".chain-snapshot strong").first()).toHaveText(report.finalStatus);
  await expect(page.getByText("Threshold", { exact: true })).toBeVisible();
  await expect(page.getByText("0.30%", { exact: true })).toBeVisible();
  await expect(page.getByText("Reported value", { exact: true })).toBeVisible();
  await expect(page.getByText("0.20%", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence hash", { exact: true })).toBeVisible();
  await expect(page.getByText(report.evidenceHash, { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture evidence · testnet only", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View resolver transaction" })).toHaveAttribute("href", `https://explorer.testnet.chain.robinhood.com/tx/${report.transactionHash}`);
  await page.goto("/market/");
  await expect(page.getByRole("link", { name: "BEA fixture proof" })).toHaveAttribute("href", "/bea-proof/");
});
