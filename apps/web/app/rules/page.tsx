import type { Metadata } from "next";
import { Frame, PageHeading } from "@/components/Frame";
import { FlowDiagram } from "@/components/FlowDiagram";
import { ClaimIcon, TokenLogo } from "@/components/TokenLogo";
import { Reveal } from "@/lib/motion";
import { eventProfile } from "@/lib/event-profile";

const rules = [
  ["Vault · split", "One deposit, two claims", "Deposit ETH or USDG into a market vault to mint equal YES and NO outcome tokens for that collateral.", "ETH", true],
  ["Pool · trade", "Three independent pools", "ETH-YES and ETH-NO expose conditional asset prices. YES-NO provides an implied outcome price. LP fee is 0.30%; QTimeline adds no protocol fee.", "USDG", false],
  ["Oracle · resolve", eventProfile.id === "ipo" ? eventProfile.copy.oracleTitle : "BEA data, hybrid authorization", eventProfile.oracleRule, "ETH", false],
  ["Claim · redeem", "Winning side pays 1:1", "After a valid result, winning claims redeem for their collateral. If unresolved 48 hours after the scheduled report time, anyone can trigger cancellation; each individual claim redeems for half, while a matched YES/NO pair merges for full collateral.", "USDG", true],
] as const;

const numbers = [
  ["0.30%", "LP fee per swap", "No QTimeline fee on top"],
  eventProfile.cutoffNumber,
  ["48 h", "Report deadline", "Then anyone can cancel"],
  ["50%", "Payout if cancelled", "Per claim; pairs merge to 100%"],
] as const;

export const metadata: Metadata = { title: "Rules and risk" };

export default function RulesPage() {
  return (
    <Frame>
      <PageHeading
        tag="Protocol rules"
        title="Know the mechanics."
        body="QTimeline prices how an asset might trade under two outcomes. Pool prices are market estimates, not probability guarantees."
        facts={[
          { label: "Assets", wide: true, value: <><span><TokenLogo asset="ETH" size={30} /> ETH</span><i aria-hidden="true">⇄</i><span><TokenLogo asset="USDG" size={30} /> USDG</span></>, sub: "ETH native and USDG; pair fixed per market" },
          { label: "Venue", value: "Uniswap v4", sub: "Hook-gated by lifecycle" },
          { label: "Signatures", value: "ECDSA + ML-DSA-44", sub: "Both must verify on-chain" },
          eventProfile.id === "ipo"
            ? { label: "Custody", value: "Upgradeable", sub: "Deployer can replace contract logic" }
            : { label: "Custody", value: "No admin exit", sub: "Deployer cannot move collateral" },
        ]}
      />
      <Reveal><FlowDiagram /></Reveal>
      <section className="numbers" aria-label="Key numbers">
        {numbers.map(([value, label, sub], i) => (
          <Reveal key={label} delay={i * 80} className="numbers__item">
            <b>{value}</b><span>{label}</span><small>{sub}</small>
          </Reveal>
        ))}
      </section>
      <section className="rules-grid rules-grid--wide">
        {rules.map(([tag, title, body, asset, yes], i) => (
          <Reveal as="article" key={tag} delay={i * 90}>
            <div className="rules-grid__icon"><ClaimIcon asset={asset} yes={yes} size={38} /></div>
            <span>{tag}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </Reveal>
        ))}
      </section>
      <div className="callout risk">Risk: pool prices move with liquidity and may diverge from any fair value. USDG depends on issuer transfer policy. Smart contract, oracle parsing, signer, RPC and hosting risks remain. Only trade money you can afford to lose.</div>
    </Frame>
  );
}
