import { Frame, PageHeading } from "@/components/Frame";
import { VotingPanel } from "@/components/VotingPanel";

export default function VotePage() {
  return <Frame><PageHeading tag="QTL GOVERNANCE" title="The next market." body="Deposit QTL before the vote begins. Your escrowed balance sets voting weight, one vote per wallet, and you can withdraw when the election window permits."/><VotingPanel/></Frame>;
}
