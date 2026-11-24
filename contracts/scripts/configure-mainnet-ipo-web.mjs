import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_CHAIN_ID, MAINNET_CORE } from "./lib/mainnet-release-config.mjs";

// Generates apps/web/.env.ipo.local for the shared-engine site. Core PCE's .env.mainnet.local is never touched.
// Default: the original Anthropic IPO market (manifest.ipoMarket). For another event on the same contracts set
//   QT_EVENT_KEY (manifest.events[key]), QT_EVENT_KIND (pce) and QT_EVENT_PERIOD_LABEL (for example "October 2026").
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(root, process.env.QTIMELINE_IPO_MANIFEST || "deployments/robinhood-mainnet-ipo.json");
const outputPath = resolve(root, "apps/web/.env.ipo.local");

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.system !== "anthropic-ipo-pricing") throw new Error("Manifest is not the Anthropic IPO pricing deployment");
  if (manifest.chainId !== MAINNET_CHAIN_ID || manifest.deployedAndSealed !== true || manifest.wiring?.verified !== true) {
    throw new Error("IPO web config requires a deployed, sealed, and readback-verified contract manifest");
  }
  const publicRpc = process.env.QTIMELINE_PUBLIC_MAINNET_RPC;
  if (!publicRpc) throw new Error("Set QTIMELINE_PUBLIC_MAINNET_RPC to an HTTPS browser-safe Robinhood RPC endpoint");
  const parsedRpc = new URL(publicRpc);
  if (parsedRpc.protocol !== "https:" || parsedRpc.username || parsedRpc.password) throw new Error("Public Mainnet RPC must use HTTPS and must not contain credentials");

  for (const name of ["IpoMarketRegistry", "IpoMarketFactory", "TimelineRouter"]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(manifest.addresses?.[name] || "")) throw new Error(`Manifest is missing ${name}`);
  }
  const eventKey = process.env.QT_EVENT_KEY;
  const market = eventKey ? manifest.events?.[eventKey] : manifest.ipoMarket;
  if (eventKey && !market?.marketId) throw new Error(`No market under manifest.events.${eventKey}; create it first`);
  const eventKind = eventKey ? (process.env.QT_EVENT_KIND || "") : "";
  if (eventKey && eventKind !== "pce") throw new Error("Set QT_EVENT_KIND=pce (the only event kind besides the original IPO market)");
  const marketId = market?.marketId && /^0x[0-9a-fA-F]{64}$/.test(market.marketId) ? market.marketId : `0x${"0".repeat(64)}`;
  const threshold = !eventKey && market?.thresholdCents ? (market.thresholdCents / 100).toFixed(2) : "";
  const eventLines = eventKey ? [
    `NEXT_PUBLIC_EVENT_KIND=${eventKind}`,
    `NEXT_PUBLIC_EVENT_THRESHOLD_BPS=${market.thresholdCents}`,
    `NEXT_PUBLIC_EVENT_PERIOD_LABEL=${process.env.QT_EVENT_PERIOD_LABEL || ""}`,
    `NEXT_PUBLIC_EVENT_CUTOFF_AT=${market.cutoffAt}`,
  ] : [];
  const content = [
    `NEXT_PUBLIC_RH_RPC=${publicRpc}`,
    `NEXT_PUBLIC_RH_CHAIN_ID=${MAINNET_CHAIN_ID}`,
    "NEXT_PUBLIC_EVENT_PROFILE=ipo",
    `NEXT_PUBLIC_IPO_THRESHOLD=${threshold}`,
    ...eventLines,
    `NEXT_PUBLIC_REGISTRY=${manifest.addresses.IpoMarketRegistry}`,
    `NEXT_PUBLIC_MARKET_ID=${marketId}`,
    `NEXT_PUBLIC_FACTORY=${manifest.addresses.IpoMarketFactory}`,
    `NEXT_PUBLIC_ROUTER=${manifest.addresses.TimelineRouter}`,
    "NEXT_PUBLIC_VOTING=",
    `NEXT_PUBLIC_V4_QUOTER=${MAINNET_CORE.Quoter}`,
    "",
  ].join("\n");
  await writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
  console.log("IPO web configuration generated at apps/web/.env.ipo.local.");
  console.log(marketId.endsWith("0".repeat(64)) ? "No IPO market ID yet: create the market, then run this again." : "Market ID and threshold were read from the IPO manifest. RPC endpoint was not printed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
