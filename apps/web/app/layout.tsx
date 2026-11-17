import type { Metadata } from "next";
import { eventProfile } from "@/lib/event-profile";
import "./style.css";
import "./extra.css";
import "./interactive.css";
import "./brand-theme.css";
import "./motion.css";
import "./market.css";
import "./timeline.css";
import "./usability.css";
import "./typography.css";

const ipo = eventProfile.id === "ipo";
const title = ipo ? "QTimeline — Anthropic IPO price market" : "QTimeline — Every pool, two timelines";
const description = ipo
  ? `${eventProfile.question} Buy YES or NO on Robinhood Chain. Each winning share pays $1.00, settled from the SEC's Form 424B4.`
  : "Split USDG into YES/NO claims, trade conditional ETH discovery across three Uniswap v4 pools, and settle under ECDSA + ML-DSA-44 on Robinhood Chain.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.qtimeline.tech"),
  title: { default: title, template: "%s · QTimeline" },
  description,
  openGraph: {
    type: "website",
    title,
    description,
    siteName: "QTimeline",
    images: [
      {
        url: "/brand/og-banner.png",
        width: 1503,
        height: 789,
        alt: "QTimeline — One IPO price, two timelines",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@QTimelineHook",
    creator: "@QTimelineHook",
    title,
    description,
    images: ["/brand/og-banner.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
