import type { Metadata } from "next";
import "./style.css";
import "./extra.css";
import "./interactive.css";
import "./brand-theme.css";
import "./motion.css";
import "./market.css";
import "./timeline.css";
import "./usability.css";
import "./typography.css";

export const metadata: Metadata = {
  title: "QTimeline — Every pool, two timelines",
  description: "Trade the price of an asset across two possible outcomes."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
