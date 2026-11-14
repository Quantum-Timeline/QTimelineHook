import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(root, "contracts/.env");

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
  const env = parseEnv(await readFile(envPath, "utf8"));
  if (!env.RH_MAINNET_RPC) throw new Error("Set RH_MAINNET_RPC in contracts/.env");
  const forge = process.platform === "win32"
    ? resolve(root, "node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe")
    : resolve(root, "node_modules/.bin/forge");
  const result = spawnSync(forge, ["test", "--root", "contracts", "--match-path", "test/MainnetFork.t.sol", "--fork-url", "robinhood", "-vv"], {
    cwd: root,
    env: { ...process.env, RH_MAINNET_RPC: env.RH_MAINNET_RPC },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
