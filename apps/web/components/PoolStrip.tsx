import { PoolPair } from "@/components/TokenLogo";
import { Reveal } from "@/lib/motion";

const pools = [
  { key: "yes", title: "ETH timeline · YES", pair: ["ETH", "USDG"] as const, sides: [true, true] as const, line: "Price of ETH if the threshold is met.", tag: "POOL 1" },
  { key: "no", title: "ETH timeline · NO", pair: ["ETH", "USDG"] as const, sides: [false, false] as const, line: "Price of ETH if it is not.", tag: "POOL 2" },
  { key: "odds", title: "YES / NO odds", pair: ["USDG", "USDG"] as const, sides: [true, false] as const, line: "The ratio between the two claims is the market's implied odds.", tag: "POOL 3" },
];

/** Three Uniswap v4 pools behind every market, shown with the claim tokens that make each one up. */
export function PoolStrip() {
  return (
    <section className="pool-strip" aria-label="The three pools behind this market">
      {pools.map((pool, i) => (
        <Reveal as="article" key={pool.key} delay={i * 90} className={`pool-card pool-card--${pool.key}`}>
          <div className="pool-card__top">
            <PoolPair a={pool.pair[0]} b={pool.pair[1]} yesA={pool.sides[0]} yesB={pool.sides[1]} />
            <span className="pool-card__tag">{pool.tag}</span>
          </div>
          <h3>{pool.title}</h3>
          <p>{pool.line}</p>
          <dl>
            <div><dt>LP FEE</dt><dd>0.30%</dd></div>
            <div><dt>ROUTE</dt><dd>Uniswap v4</dd></div>
            <div><dt>PROTOCOL FEE</dt><dd>None</dd></div>
          </dl>
        </Reveal>
      ))}
    </section>
  );
}
