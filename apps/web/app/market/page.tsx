import { Frame, PageHeading } from "@/components/Frame";
import { MarketSnapshot } from "@/components/MarketSnapshot";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { OddsGauge } from "@/components/OddsGauge";
import { robinhoodChain } from "@qtimeline/chain";

export default function MarketPage() {
  const testnet = robinhoodChain.id === 46630;
  const testEvent = process.env.NEXT_PUBLIC_TEST_EVENT_LABEL;
  const testSource = process.env.NEXT_PUBLIC_TEST_SOURCE_LABEL;

  return (
    <Frame>
      <PageHeading
        tag={testnet ? "TESTNET · MARKET LIFECYCLE SMOKE" : "MARKET · CORE PCE OCT 2026"}
        title={testnet ? "Test the market lifecycle." : "Two paths for ETH."}
        body={
          testnet
            ? "A short-window test market on Robinhood Chain Testnet exercises trading, resolution, cancellation, and redemption with synthetic evidence."
            : "Read the lifecycle and quote live from Robinhood Chain. Trades split collateral, route through the selected Uniswap v4 pool, and return the paired opposite claim atomically."
        }
      />

      {testnet && (
        <div className="callout">
          Testnet only · synthetic event · faucet USDG · no real-world oracle result.
        </div>
      )}

      {testnet && process.env.NEXT_PUBLIC_BEA_TESTNET_MARKET_ID && <div className="callout"><a className="proof-link" href="/bea-proof/">View BEA fixture resolution proof</a></div>}

      <div className="market-workspace">
        <section className="detail-card">
          <div className="detail-card__head">
            <span className="detail-card__kicker">MARKET SPECIFICATION</span>
            <span className="detail-card__pill">UNISWAP V4 · 0.30% FEE</span>
          </div>
          <div className="detail-row">
            <span>QUESTION</span>
            <strong>
              {testnet
                ? testEvent ?? "QTimeline test market"
                : "Did US Core PCE rise at least 0.3% month over month?"}
            </strong>
          </div>
          <div className="detail-row">
            <span>RESOLUTION SOURCE</span>
            <strong>
              {testnet
                ? testSource ?? "Synthetic test evidence only; no real-world event"
                : "First BEA Personal Income and Outlays release for October 2026"}
            </strong>
          </div>
          <div className="detail-row">
            <span>ASSETS</span>
            <strong>
              {testnet ? "ETH claims · faucet USDG test token" : "ETH native · USDG collateral"}
            </strong>
          </div>
          <OddsGauge />
          <MarketSnapshot />
        </section>

        <MarketTradePanel />
      </div>
    </Frame>
  );
}
