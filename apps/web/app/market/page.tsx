import { Frame, PageHeading } from "@/components/Frame";
import { HowToTrade } from "@/components/HowToTrade";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { PoolStrip } from "@/components/PoolStrip";
import { QuickBet } from "@/components/QuickBet";
import { TokenLogo } from "@/components/TokenLogo";
import { WorldLane } from "@/components/WorldLane";
import { robinhoodChain } from "@qtimeline/chain";
import { eventProfile } from "@/lib/event-profile";

export default function MarketPage() {
  const testnet = robinhoodChain.id === 46630;
  const testEvent = process.env.NEXT_PUBLIC_TEST_EVENT_LABEL;
  const testSource = process.env.NEXT_PUBLIC_TEST_SOURCE_LABEL;
  const isIpo = !testnet && eventProfile.id === "ipo";
  const question = testnet ? testEvent ?? "QTimeline test market" : eventProfile.question;
  const source = testnet
    ? testSource ?? "Synthetic test evidence only; no real-world event"
    : eventProfile.source;

  return (
    <Frame>
      <div className={isIpo ? "ipo-market" : undefined}>
      <PageHeading
        tag={testnet ? "Testnet · lifecycle smoke test" : eventProfile.tag}
        title={testnet ? "Test the market lifecycle." : isIpo ? question : "Two paths for ETH."}
        body={testnet
          ? "A short-window test market on Robinhood Chain Testnet exercises trading, resolution, cancellation, and redemption with synthetic evidence."
          : isIpo ? "Pick a side. If you are right, each share pays $1.00 once the SEC publishes the final price. If not, it pays $0."
          : "Read the lifecycle and quote live from Robinhood Chain. Trades split collateral, route through the selected Uniswap v4 pool, and return the paired opposite claim atomically."}
        note={testnet ? <>Testnet only · synthetic event · faucet USDG · no real-world oracle result.{process.env.NEXT_PUBLIC_BEA_TESTNET_MARKET_ID && <> <a className="proof-link" href="/bea-proof/">BEA fixture proof ↗</a></>}</> : undefined}
        facts={isIpo ? undefined : [
          { label: "Assets", wide: true, value: <><span><TokenLogo asset="ETH" size={26} /> ETH</span><i aria-hidden="true">⇄</i><span><TokenLogo asset="USDG" size={26} /> USDG</span></> },
          { label: "Venue", value: "Uniswap v4", sub: "3 pools · 0.30% fee" },
          { label: "Network", value: testnet ? "Robinhood Testnet" : "Robinhood Chain", sub: `Chain ${robinhoodChain.id}` },
          { label: "Payout", value: "Winner 1 : 1", sub: "Cancelled pays 50%" },
        ]}
      />

      {isIpo && <QuickBet />}

      <HowToTrade />

      <section className="question">
        <span className="question__label">{isIpo ? "How it resolves" : "The question"}</span>
        {!isIpo && <h2>{question}</h2>}
        <p><b>Resolves from</b> {source}</p>
      </section>

      {!testnet && !process.env.NEXT_PUBLIC_MARKET_ID?.replace(/^0x0+$/, "") && (
        <div className="soon" role="status">
          <b>Trading opens soon</b>
          <span>The market is being set up on Robinhood Chain. Odds, quotes and trading unlock here the moment it goes live.</span>
        </div>
      )}

      <div className="worlds">
        <WorldLane yes label={isIpo ? "If YES wins" : "YES world"} />
        <MarketTradePanel />
        <WorldLane yes={false} label={isIpo ? "If NO wins" : "NO world"} />
      </div>

      <section className="spine">
        <h3 className="spine__title">Where this market is on its timeline</h3>
        <MarketSnapshot />
      </section>

      <PoolStrip />
      </div>
    </Frame>
  );
}
