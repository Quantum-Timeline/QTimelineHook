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
// The shared banner artwork is about the IPO price, so it is only attached to that event's link previews.
const banner = eventProfile.event === "ipo" ? [{ url: "/brand/og-banner.png", width: 1503, height: 789, alt: "QTimeline: One IPO price, two timelines" }] : undefined;

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
    card: banner ? "summary_large_image" : "summary",
    site: "@QTimelineHook",
    creator: "@QTimelineHook",
    title,
    description,
    images: banner ? ["/brand/og-banner.png"] : undefined,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
