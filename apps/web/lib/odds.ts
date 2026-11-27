"use client";

import { useEffect, useMemo, useState } from "react";
import { createPublicClient, http, isAddress, isHex, parseAbi, type Address } from "viem";
import { robinhoodChain } from "@qtimeline/chain";
import { useMarketId } from "@/lib/use-market-id";
import { canTradeAt } from "@/lib/market-lifecycle";

const registryAbi = parseAbi(["function market(bytes32) view returns ((bytes32 configHash,address vault,address asset,uint64 opensAt,uint64 cutoffAt,uint64 releaseAt,uint64 deadline,bytes32 periodId,int32 thresholdBps,uint8 status,bool activated))"]);
const factoryAbi = parseAbi([
  "function tokens(bytes32) view returns (address[4])",
  "function poolKeys(bytes32) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)[3])",
]);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const PROBE = 10_000n; // 0.01 USDG claim: small enough to read the spot ratio, large enough to survive rounding

export type Odds = { yes?: number; note: string; /** On-chain status once trading is closed (4 = final YES, 5 = final NO). */ status?: number };

/** Implied YES probability from the YES/NO pool spot ratio. A market estimate, never a contract input. */
export function useOdds(): Odds {
  const marketId = useMarketId();
  const registry = process.env.NEXT_PUBLIC_REGISTRY as Address | undefined;
  const factory = process.env.NEXT_PUBLIC_FACTORY as Address | undefined;
  const quoter = process.env.NEXT_PUBLIC_V4_QUOTER as Address | undefined;
  const [odds, setOdds] = useState<Odds>({ note: "Reading the YES / NO pool…" });
  const client = useMemo(() => createPublicClient({ chain: robinhoodChain, transport: http(process.env.NEXT_PUBLIC_RH_RPC || undefined) }), []);
  const ready = !!marketId && isHex(marketId) && marketId.length === 66 && !/^0x0{64}$/i.test(marketId)
    && [registry, factory, quoter].every((a) => !!a && isAddress(a));

  useEffect(() => {
    if (!ready || !registry || !factory || !quoter || !marketId) { setOdds({ note: "Odds appear once trading opens." }); return; }
    let active = true;
    async function read() {
      try {
        const [market, tokens, keys, block] = await Promise.all([
          client.readContract({ address: registry!, abi: registryAbi, functionName: "market", args: [marketId!] }),
          client.readContract({ address: factory!, abi: factoryAbi, functionName: "tokens", args: [marketId!] }),
          client.readContract({ address: factory!, abi: factoryAbi, functionName: "poolKeys", args: [marketId!] }),
          client.getBlock(),
        ]);
        if (!canTradeAt({ status: market.status, activated: market.activated, opensAt: market.opensAt, cutoffAt: market.cutoffAt, chainTimestamp: block.timestamp })) {
          if (active) setOdds({ note: market.status >= 3 ? "Trading is closed; odds are frozen." : "Odds open with trading.", status: market.status });
          return;
        }
        const pool = keys[2];
        const zeroForOne = pool.currency0.toLowerCase() === tokens[2].toLowerCase();
        const { result } = await client.simulateContract({ address: quoter!, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: pool, zeroForOne, exactAmount: PROBE, hookData: "0x" }] });
        const noPerYes = (Number(result[0]) * 1000) / (Number(PROBE) * 997); // undo the 0.30% fee to approximate spot
        const p = noPerYes / (1 + noPerYes);
        if (active && Number.isFinite(p)) setOdds({ yes: Math.min(0.99, Math.max(0.01, p)), note: "Estimate from the YES / NO pool price. Not a guarantee." });
      } catch {
        if (active) setOdds({ note: "Odds are unavailable right now." });
      }
    }
    void read();
    const timer = window.setInterval(read, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client, factory, marketId, quoter, ready, registry]);

  return odds;
}
