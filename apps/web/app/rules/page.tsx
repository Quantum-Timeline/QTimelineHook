import { Frame, PageHeading } from "@/components/Frame";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Reveal } from "@/lib/motion";

const rules = [
  ["VAULT // SPLIT", "One deposit, two claims", "Deposit ETH or USDG into a market vault to mint equal YES and NO outcome tokens for that collateral."],
  ["POOL // TRADE", "Three independent pools", "ETH-YES and ETH-NO expose conditional asset prices. YES-NO provides an implied outcome price. LP fee is 0.30%; QTimeline adds no protocol fee."],
  ["ORACLE // RESOLVE", "BEA data, hybrid authorization", "A project bot reads the first official BEA release. The report digest requires both ECDSA and ML-DSA-44 signatures. These keys share project control; the signature does not independently prove the BEA number."],
  ["CLAIM // REDEEM", "Winning side pays 1:1", "After a valid result, winning claims redeem for their collateral. If unresolved 48 hours after scheduled release, anyone can trigger cancellation; each individual claim redeems for half, while a matched YES/NO pair merges for full collateral."],
] as const;

export default function RulesPage() {
  return (
    <Frame>
      <PageHeading tag="PROTOCOL RULES" title="Know the mechanics." body="QTimeline prices how an asset might trade under two outcomes. Pool prices are market estimates, not probability guarantees." />
      <Reveal><FlowDiagram /></Reveal>
      <section className="rules-grid">
        {rules.map(([tag, title, body], i) => (
          <Reveal as="article" key={tag} delay={i * 90}>
            <span>{tag}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </Reveal>
        ))}
      </section>
      <div className="callout risk">Risk: pool prices move with liquidity and may diverge from any fair value. USDG depends on issuer transfer policy. Smart contract, oracle parsing, signer, RPC and hosting risks remain. This market is not live in this build.</div>
    </Frame>
  );
}
