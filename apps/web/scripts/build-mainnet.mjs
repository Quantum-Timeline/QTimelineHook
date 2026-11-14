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
  const mainnetEnv = parseEnv(await readFile(resolve(webRoot, ".env.mainnet.local"), "utf8"));
  if (mainnetEnv.NEXT_PUBLIC_RH_CHAIN_ID !== "4663") throw new Error("Mainnet web config must target chain ID 4663");
  for (const name of ["NEXT_PUBLIC_REGISTRY", "NEXT_PUBLIC_FACTORY", "NEXT_PUBLIC_ROUTER", "NEXT_PUBLIC_VOTING", "NEXT_PUBLIC_V4_QUOTER"]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(mainnetEnv[name] || "")) throw new Error(`Mainnet web config is missing a valid ${name}`);
  }
  const nextCli = resolve(repoRoot, "node_modules/next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: webRoot,
    env: { ...process.env, ...mainnetEnv },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
