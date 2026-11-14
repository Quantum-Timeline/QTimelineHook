import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const at = trimmed.indexOf("=");
    if (at < 1) return [];
    return [[trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

try {
  const mainnetEnv = parseEnv(await readFile(resolve(webRoot, ".env.ipo.local"), "utf8"));
  if (mainnetEnv.NEXT_PUBLIC_RH_CHAIN_ID !== "4663") throw new Error("IPO web config must target chain ID 4663");
  if (mainnetEnv.NEXT_PUBLIC_EVENT_PROFILE !== "ipo") throw new Error("IPO web config must set NEXT_PUBLIC_EVENT_PROFILE=ipo");
  for (const name of ["NEXT_PUBLIC_REGISTRY", "NEXT_PUBLIC_FACTORY", "NEXT_PUBLIC_ROUTER", "NEXT_PUBLIC_V4_QUOTER"]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(mainnetEnv[name] || "")) throw new Error(`IPO web config is missing a valid ${name}`);
  }
  const nextCli = resolve(webRoot, "node_modules/next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: webRoot,
    // A separate output directory keeps the IPO site from overwriting the Core PCE export or a running dev server's cache.
    env: {
      ...process.env,
      // Testnet-only variables in apps/web/.env.local must never reach a Mainnet build; an empty value wins over the env file.
      ...Object.fromEntries(["NEXT_PUBLIC_TEST_EVENT_LABEL", "NEXT_PUBLIC_TEST_SOURCE_LABEL", "NEXT_PUBLIC_TEST_YES_LABEL", "NEXT_PUBLIC_TEST_NO_LABEL", "NEXT_PUBLIC_ELECTION_ID", "NEXT_PUBLIC_VOTE_CANDIDATE_A_ID", "NEXT_PUBLIC_VOTE_CANDIDATE_B_ID", "NEXT_PUBLIC_BEA_TESTNET_MARKET_ID", "NEXT_PUBLIC_BEA_TESTNET_REGISTRY", "NEXT_PUBLIC_BEA_TESTNET_REPORT_TX"].map((name) => [name, ""])),
      ...mainnetEnv,
      QT_WEB_DIST_DIR: "out-ipo",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
