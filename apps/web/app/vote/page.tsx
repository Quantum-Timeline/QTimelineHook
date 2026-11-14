import { Frame, PageHeading } from "@/components/Frame";
import { GuideCard } from "@/components/GuideCard";
import { QtlMark } from "@/components/TokenLogo";
import { VotingPanel } from "@/components/VotingPanel";

export default function VotePage() {
  return (
    <Frame>
      <PageHeading
        tag="QTL governance"
        title="The next market."
        body="Deposit QTL before the vote begins. Your escrowed balance sets voting weight, one vote per wallet, and you can withdraw when the election window permits."
        facts={[
          { label: "Token", wide: true, value: <span><QtlMark size={30} /> QTL</span>, sub: "Escrowed in the voting contract while the vote runs" },
          { label: "Weight", value: "1 QTL = 1 vote", sub: "Fixed when voting starts" },
          { label: "Windows", value: "24h + 24h", sub: "Deposit, then vote" },
          { label: "On a tie", value: "Candidate B", sub: "The announced default" },
        ]}
      />
      <div className="split-layout">
        <VotingPanel />
        <GuideCard
          kicker="How voting works"
          title="From deposit to the next market"
          steps={[
            { icon: <QtlMark size={34} />, title: "Deposit QTL", body: "Escrow the amount you want counted before voting opens. Moving tokens between wallets later adds no weight." },
            { icon: <QtlMark size={34} />, title: "Vote once", body: "Pick one of two fixed thresholds for the next Core PCE release. Each wallet votes a single time." },
            { icon: <QtlMark size={34} />, title: "Anyone finalizes", body: "After the window closes anyone can finalize. The most votes win; a tie or zero votes picks candidate B." },
            { icon: <QtlMark size={34} />, title: "Withdraw your escrow", body: "Your tokens come back once voting ends, or before it starts. The winner binds the second market's configuration." },
          ]}
        />
      </div>
    </Frame>
  );
}
