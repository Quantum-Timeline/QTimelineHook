import { Frame, PageHeading } from "@/components/Frame";
import { GuideCard } from "@/components/GuideCard";
import { PositionsPanel } from "@/components/PositionsPanel";
import { ClaimIcon, TokenLogo } from "@/components/TokenLogo";

export default function PositionsPage() {
  return (
    <Frame>
      <PageHeading
        tag="Your claims"
        title="Positions."
        body="Read your four conditional token balances directly from the market vault. Merge paired claims before resolution or redeem eligible claims after the result is final."
        facts={[
          { label: "Assets", wide: true, value: <><span><TokenLogo asset="ETH" size={30} /> ETH</span><i aria-hidden="true">⇄</i><span><TokenLogo asset="USDG" size={30} /> USDG</span></>, sub: "Each asset has its own YES and NO claim" },
          { label: "Claim tokens", value: "4 per market", sub: "ETH YES · ETH NO · USDG YES · USDG NO" },
          { label: "Before the result", value: "Merge pairs", sub: "YES + NO returns full collateral" },
          { label: "After the result", value: "Redeem", sub: "Winner 1 : 1 · cancelled pays 50%" },
        ]}
      />
      <div className="split-layout">
        <PositionsPanel />
        <GuideCard
          kicker="How claims work"
          title="What you can do with a claim"
          steps={[
            { icon: <ClaimIcon asset="ETH" yes size={36} />, title: "Hold the position you traded", body: "A buy leaves you with the claim you chose plus the paired claim on your input collateral." },
            { icon: <ClaimIcon asset="USDG" yes={false} size={36} />, title: "Merge before the result", body: "One YES and one NO of the same asset merge back into that asset, any time before resolution." },
            { icon: <ClaimIcon asset="ETH" yes size={36} />, title: "Redeem a winner 1 : 1", body: "After a valid result, the winning claim redeems for its collateral. The losing claim is worth zero." },
            { icon: <ClaimIcon asset="USDG" yes={false} size={36} />, title: "Cancelled pays half", body: "If no result arrives within 48 hours of the scheduled report time, anyone can cancel; every claim redeems for 50%." },
          ]}
        />
      </div>
    </Frame>
  );
}
