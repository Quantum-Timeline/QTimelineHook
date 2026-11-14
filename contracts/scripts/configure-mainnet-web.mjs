import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_CHAIN_ID, MAINNET_CORE } from "./lib/mainnet-release-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(root, process.env.QTIMELINE_MAINNET_MANIFEST || "deployments/robinhood-mainnet.json");
const outputPath = resolve(root, "apps/web/.env.mainnet.local");

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.chainId !== MAINNET_CHAIN_ID || manifest.deployedAndSealed !== true || manifest.wiring?.verified !== true) {
    throw new Error("Mainnet web config requires a deployed, sealed, and readback-verified contract manifest");
  }
  const publicRpc = process.env.QTIMELINE_PUBLIC_MAINNET_RPC;
  if (!publicRpc) throw new Error("Set QTIMELINE_PUBLIC_MAINNET_RPC to an HTTPS browser-safe Robinhood RPC endpoint");
  const parsedRpc = new URL(publicRpc);
  if (parsedRpc.protocol !== "https:" || parsedRpc.username || parsedRpc.password) throw new Error("Public Mainnet RPC must use HTTPS and must not contain credentials");

  const required = ["MarketRegistry", "MarketFactory", "TimelineRouter", "QTLVoting"];
  for (const name of required) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(manifest.addresses?.[name] || "")) throw new Error(`Manifest is missing ${name}`);
  }
  const content = [
    `NEXT_PUBLIC_RH_RPC=${publicRpc}`,
    `NEXT_PUBLIC_RH_CHAIN_ID=${MAINNET_CHAIN_ID}`,
    `NEXT_PUBLIC_REGISTRY=${manifest.addresses.MarketRegistry}`,
    "NEXT_PUBLIC_MARKET_ID=0x0000000000000000000000000000000000000000000000000000000000000000",
    `NEXT_PUBLIC_FACTORY=${manifest.addresses.MarketFactory}`,
    `NEXT_PUBLIC_ROUTER=${manifest.addresses.TimelineRouter}`,
    `NEXT_PUBLIC_VOTING=${manifest.addresses.QTLVoting}`,
    "NEXT_PUBLIC_ELECTION_ID=",
    "NEXT_PUBLIC_VOTE_CANDIDATE_A_ID=",
    "NEXT_PUBLIC_VOTE_CANDIDATE_B_ID=",
    "NEXT_PUBLIC_VOTE_CANDIDATE_A_LABEL=Core PCE · 0.20% threshold",
    "NEXT_PUBLIC_VOTE_CANDIDATE_B_LABEL=Core PCE · 0.30% threshold",
    `NEXT_PUBLIC_V4_QUOTER=${MAINNET_CORE.Quoter}`,
    "",
  ].join("\n");
  await writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
  console.log("Mainnet web configuration generated at apps/web/.env.mainnet.local.");
  console.log("Market and election IDs remain unset until their on-chain setup is complete. RPC endpoint was not printed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
