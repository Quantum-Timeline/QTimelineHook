import Link from "next/link";
import { Frame } from "@/components/Frame";

export default function NotFound() {
  return <Frame><section className="not-found"><small>404 · NO TIMELINE FOUND</small><h1>This page isn’t in this market.</h1><p>Return to the market overview or check the address.</p><Link className="primary" href="/">Back to QTimeline <span>↗</span></Link></section></Frame>;
}
