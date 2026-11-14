"use client";
import { useEffect, useState } from "react";
import { createPublicClient, http, isHex, parseAbi, type Address, type Hex } from "viem";
import { registryAbi, robinhoodChain } from "@qtimeline/chain";
import { useMarketId } from "@/lib/use-market-id";
import { canTradeAt } from "@/lib/market-lifecycle";
import { MarketTimeline } from "@/components/MarketTimeline";

type Snapshot = { status: number; opensAt: bigint; cutoffAt: bigint; releaseAt: bigint; deadline: bigint; thresholdBps: number; activated: boolean; chainTimestamp: bigint; reportedValueBps?: number; evidenceHash?: Hex };
const labels = ["Draft", "Scheduled", "Open", "Awaiting result", "Final YES", "Final NO", "Cancelled", "Discarded"];
const INITIAL_MESSAGE = "No verified deployment manifest configured.";
const resolutionAbi = parseAbi(["function reportedValueBps(bytes32) view returns (int32)", "function evidenceHash(bytes32) view returns (bytes32)"]);

export function MarketSnapshot({ registryOverride, marketIdOverride, fixtureEvidence = false }: { registryOverride?: Address; marketIdOverride?: Hex; fixtureEvidence?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const registry = registryOverride ?? process.env.NEXT_PUBLIC_REGISTRY as Address | undefined;
  const configuredMarketId = useMarketId();
  const marketId = marketIdOverride ?? configuredMarketId;

  useEffect(() => {
    if (!registry || registry === "0x0000000000000000000000000000000000000000" || !marketId || !isHex(marketId) || marketId.length !== 66 || /^0x0{64}$/i.test(marketId)) return;
    let active = true;
    const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.NEXT_PUBLIC_RH_RPC || undefined) });
    async function refresh() {
      try {
        const code = await client.getBytecode({ address: registry! });
        if (!code || code === "0x") throw new Error("Registry has no bytecode on Robinhood Chain.");
        const [market, block] = await Promise.all([
          client.readContract({ address: registry!, abi: registryAbi, functionName: "market", args: [marketId!] }),
          client.getBlock(),
        ]);
        if (!market.vault) throw new Error("Market ID is not registered.");
        const final = market.status === 4 || market.status === 5;
        const [reportedValueBps, evidenceHash] = final ? await Promise.all([
          client.readContract({ address: registry!, abi: resolutionAbi, functionName: "reportedValueBps", args: [marketId!] }),
          client.readContract({ address: registry!, abi: resolutionAbi, functionName: "evidenceHash", args: [marketId!] }),
        ]) : [undefined, undefined];
        if (active) { setSnapshot({ status: market.status, opensAt: market.opensAt, cutoffAt: market.cutoffAt, releaseAt: market.releaseAt, deadline: market.deadline, thresholdBps: market.thresholdBps, activated: market.activated, chainTimestamp: block.timestamp, reportedValueBps, evidenceHash }); setMessage(""); }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "Could not read market from chain."); }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [registry, marketId]);

  if (!snapshot) {
    const configured = !!registry && registry !== "0x0000000000000000000000000000000000000000" && !!marketId && isHex(marketId) && marketId.length === 66 && !/^0x0{64}$/i.test(marketId);
    // Configured and no error yet: the first chain read is in flight, so show a shimmering placeholder instead of a stale notice.
    return configured && message === INITIAL_MESSAGE
      ? <div className="snapshot-skeleton" aria-busy="true"><span /><span /><span /><span /></div>
      : <div className="callout">{message}</div>;
  }
  const liveStatus = snapshot.activated && snapshot.status < 4
    ? snapshot.chainTimestamp < snapshot.opensAt ? 1 : snapshot.chainTimestamp < snapshot.cutoffAt ? 2 : 3
    : snapshot.status;
  const tradeable = canTradeAt(snapshot);
  const syntheticTest = !fixtureEvidence && Boolean(process.env.NEXT_PUBLIC_TEST_EVENT_LABEL);
  return <>
    <MarketTimeline status={snapshot.status} activated={snapshot.activated} opensAt={snapshot.opensAt} cutoffAt={snapshot.cutoffAt} releaseAt={snapshot.releaseAt} deadline={snapshot.deadline} chainTimestamp={snapshot.chainTimestamp} />
    <div className="chain-snapshot"><div><small>ON-CHAIN / TIME STATUS</small><strong>{labels[liveStatus] ?? "Unknown"}</strong></div><div><small>{syntheticTest ? "TEST MARKET" : "THRESHOLD"}</small><strong>{syntheticTest ? "Synthetic YES / NO event" : `${(snapshot.thresholdBps / 100).toFixed(2)}%`}</strong></div><div><small>CUTOFF</small><strong>{new Date(Number(snapshot.cutoffAt) * 1000).toLocaleString()}</strong></div><div><small>RESULT DEADLINE</small><strong>{new Date(Number(snapshot.deadline) * 1000).toLocaleString()}</strong></div><p>{tradeable ? "Market is inside its on-chain trading window." : "Market configuration and time are read from Robinhood Chain."}</p></div>
    {(snapshot.status === 4 || snapshot.status === 5) && snapshot.reportedValueBps !== undefined && snapshot.evidenceHash && <div className="resolution-proof" data-testid="resolution-proof">
      <div><small>REPORTED VALUE</small><strong>{(snapshot.reportedValueBps / 100).toFixed(2)}%</strong></div>
      <div><small>ON-CHAIN RESULT</small><strong>{labels[snapshot.status]}</strong></div>
      <div className="resolution-proof__hash"><small>EVIDENCE HASH</small><code>{snapshot.evidenceHash}</code></div>
      {(syntheticTest || fixtureEvidence) && <p>Fixture evidence · testnet only</p>}
    </div>}
  </>;
}
