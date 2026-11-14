import { Frame, PageHeading } from "@/components/Frame";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import type { Address, Hex } from "viem";

export default function BeaProofPage() {
  const registry = process.env.NEXT_PUBLIC_BEA_TESTNET_REGISTRY as Address | undefined;
  const marketId = process.env.NEXT_PUBLIC_BEA_TESTNET_MARKET_ID as Hex | undefined;
  const transactionHash = process.env.NEXT_PUBLIC_BEA_TESTNET_REPORT_TX as Hex | undefined;
  const configured = Boolean(registry && marketId);

  return (
    <Frame>
      <PageHeading
        tag="TESTNET · BEA FIXTURE"
        title="BEA fixture, on chain."
        body="A read-only view of the parsed archive, signed report outcome, and evidence hash recorded by the Robinhood Chain testnet registry."
      />
      <div className="callout">Archived BEA HTML fixture · mock run, not a live result.</div>
      {configured ? <MarketSnapshot registryOverride={registry} marketIdOverride={marketId} fixtureEvidence /> : (
        <div className="callout">BEA testnet proof is not configured. Set NEXT_PUBLIC_BEA_TESTNET_REGISTRY and NEXT_PUBLIC_BEA_TESTNET_MARKET_ID.</div>
      )}
      {transactionHash && <div className="callout"><a className="proof-link" href={`https://explorer.testnet.chain.robinhood.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">View resolver transaction ↗</a></div>}
    </Frame>
  );
}
