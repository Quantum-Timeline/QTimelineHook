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

const title = eventProfile.metaTitle;
const description = eventProfile.metaDescription;
// Each event has its own link-preview artwork: the IPO banner for the IPO market, a Core PCE banner for the macro market.
const bannerUrl = eventProfile.banner?.url ?? (eventProfile.event === "ipo" ? "/brand/og-banner.png" : "/brand/og-pce.png");
const banner = eventProfile.banner
  ? [eventProfile.banner]
  : eventProfile.event === "ipo"
  ? [{ url: bannerUrl, width: 1503, height: 789, alt: "QTimeline: One IPO price, two timelines" }]
  : [{ url: bannerUrl, width: 1200, height: 630, alt: "QTimeline: Bet on inflation, before it prints" }];

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.qtimeline.tech"),
  title: { default: title, template: "%s · QTimeline" },
  description,
  openGraph: {
    type: "website",
    title,
    description,
    siteName: "QTimeline",
    images: banner,
  },
  twitter: {
    card: "summary_large_image",
    site: "@QTimelineHook",
    creator: "@QTimelineHook",
    title,
    description,
    images: [bannerUrl],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
