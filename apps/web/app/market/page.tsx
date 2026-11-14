import { Frame, PageHeading } from "@/components/Frame";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { PoolStrip } from "@/components/PoolStrip";
import { TokenLogo } from "@/components/TokenLogo";
import { WorldLane } from "@/components/WorldLane";
import { robinhoodChain } from "@qtimeline/chain";

export default function MarketPage() {
  const testnet = robinhoodChain.id === 46630;
  const testEvent = process.env.NEXT_PUBLIC_TEST_EVENT_LABEL;
  const testSource = process.env.NEXT_PUBLIC_TEST_SOURCE_LABEL;
  const question = testnet ? testEvent ?? "QTimeline test market" : "Did US Core PCE rise at least 0.3% month over month?";
  const source = testnet
    ? testSource ?? "Synthetic test evidence only; no real-world event"
    : "First BEA Personal Income and Outlays release for October 2026";

  return (
    <Frame>
      <PageHeading
        tag={testnet ? "Testnet · lifecycle smoke test" : "Core PCE · October 2026"}
        title={testnet ? "Test the market lifecycle." : "Two paths for ETH."}
        body={testnet
          ? "A short-window test market on Robinhood Chain Testnet exercises trading, resolution, cancellation, and redemption with synthetic evidence."
          : "Read the lifecycle and quote live from Robinhood Chain. Trades split collateral, route through the selected Uniswap v4 pool, and return the paired opposite claim atomically."}
        note={testnet ? <>Testnet only · synthetic event · faucet USDG · no real-world oracle result.{process.env.NEXT_PUBLIC_BEA_TESTNET_MARKET_ID && <> <a className="proof-link" href="/bea-proof/">BEA fixture proof ↗</a></>}</> : undefined}
        facts={[
          { label: "Assets", wide: true, value: <><span><TokenLogo asset="ETH" size={26} /> ETH</span><i aria-hidden="true">⇄</i><span><TokenLogo asset="USDG" size={26} /> USDG</span></> },
          { label: "Venue", value: "Uniswap v4", sub: "3 pools · 0.30% fee" },
          { label: "Network", value: testnet ? "Robinhood Testnet" : "Robinhood Chain", sub: `Chain ${robinhoodChain.id}` },
          { label: "Payout", value: "Winner 1 : 1", sub: "Cancelled pays 50%" },
        ]}
      />

      <section className="question">
        <span className="question__label">The question</span>
        <h2>{question}</h2>
        <p><b>Resolves from</b> {source}</p>
      </section>

      <div className="worlds">
        <WorldLane yes label="YES world" />
        <MarketTradePanel />
        <WorldLane yes={false} label="NO world" />
      </div>

      <section className="spine">
        <h3 className="spine__title">Where this market is on its timeline</h3>
        <MarketSnapshot />
      </section>

      <PoolStrip />
    </Frame>
  );
}
