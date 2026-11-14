import { Frame, PageHeading } from "@/components/Frame";
import { PositionsPanel } from "@/components/PositionsPanel";

export default function PositionsPage() {
  return <Frame><PageHeading tag="YOUR CLAIMS" title="Positions." body="Read your four conditional token balances directly from the market vault. Merge paired claims before resolution or redeem eligible claims after the result is final."/><PositionsPanel/></Frame>;
}
