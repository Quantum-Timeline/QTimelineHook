import { Frame } from "@/components/Frame";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { OddsGauge } from "@/components/OddsGauge";
import { PoolStrip } from "@/components/PoolStrip";
import { TokenLogo } from "@/components/TokenLogo";
import { robinhoodChain } from "@qtimeline/chain";

export default function MarketPage() {
  const testnet = robinhoodChain.id === 46630;
  const testEvent = process.env.NEXT_PUBLIC_TEST_EVENT_LABEL;
  const testSource = process.env.NEXT_PUBLIC_TEST_SOURCE_LABEL;
  const question = testnet ? testEvent ?? "QTimeline test market" : "Did US Core PCE rise at least 0.3% month over month?";

  return (
    <Frame wide>
      <section className="market-hero">
        <div className="market-hero__copy">
          <p className="market-hero__tag">{testnet ? "TESTNET · MARKET LIFECYCLE SMOKE" : "MARKET · CORE PCE OCT 2026"}</p>
          <h1>{testnet ? "Test the market lifecycle." : "Two paths for ETH."}</h1>
          <p className="market-hero__intro">
            {testnet
              ? "A short-window test market on Robinhood Chain Testnet exercises trading, resolution, cancellation, and redemption with synthetic evidence."
              : "Read the lifecycle and quote live from Robinhood Chain. Trades split collateral, route through the selected Uniswap v4 pool, and return the paired opposite claim atomically."}
          </p>
          {testnet && (
            <p className="market-hero__note">
              Testnet only · synthetic event · faucet USDG · no real-world oracle result.
              {process.env.NEXT_PUBLIC_BEA_TESTNET_MARKET_ID && <> <a className="proof-link" href="/bea-proof/">BEA fixture resolution proof ↗</a></>}
            </p>
          )}
        </div>

        <aside className="market-hero__facts" aria-label="Market at a glance">
          <div className="fact fact--assets">
            <span className="fact__label">ASSETS</span>
            <div className="fact__assets">
              <span><TokenLogo asset="ETH" size={30} /> ETH</span>
              <i aria-hidden="true">⇄</i>
              <span><TokenLogo asset="USDG" size={30} /> USDG</span>
            </div>
            <small>{testnet ? "ETH claims · faucet USDG test token" : "ETH native · USDG collateral"}</small>
          </div>
          <div className="fact"><span className="fact__label">VENUE</span><strong>Uniswap v4</strong><small>3 pools · 0.30% LP fee</small></div>
          <div className="fact"><span className="fact__label">NETWORK</span><strong>{testnet ? "Robinhood Testnet" : "Robinhood Chain"}</strong><small>Chain ID {robinhoodChain.id}</small></div>
          <div className="fact"><span className="fact__label">PAYOUT</span><strong>Winner 1 : 1</strong><small>Cancelled pays 50% per claim</small></div>
        </aside>
      </section>

      <div className="market-workspace">
        <section className="detail-card">
          <div className="detail-card__head">
            <span className="detail-card__kicker">MARKET SPECIFICATION</span>
            <span className="detail-card__pill">UNISWAP V4 · 0.30% FEE</span>
          </div>
          <div className="detail-question">
            <span>QUESTION</span>
            <h2>{question}</h2>
          </div>
          <div className="detail-row">
            <span>RESOLUTION SOURCE</span>
            <strong>
              {testnet
                ? testSource ?? "Synthetic test evidence only; no real-world event"
                : "First BEA Personal Income and Outlays release for October 2026"}
            </strong>
          </div>
          <OddsGauge />
          <MarketSnapshot />
        </section>

        <MarketTradePanel />
      </div>

      <PoolStrip />
    </Frame>
  );
}
