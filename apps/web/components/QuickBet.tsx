"use client";

import Link from "next/link";
import { AnimatedNumber } from "@/lib/motion";
import { useOdds } from "@/lib/odds";
import { eventProfile } from "@/lib/event-profile";

/**
 * One card, two sides. The seam sits at the market's price: the side the crowd favours is the wider one.
 * Each half is a button that sets the ticket below. The ruler underneath places the threshold on the price line.
 */
export function QuickBet() {
  const { yes: pYes, status } = useOdds();
  const settled = status === 4 || status === 5;
  const ruler = eventProfile.ruler ?? { min: 50, max: 110, threshold: 74, format: (n: number) => `$${n.toFixed(2)}` };
  const closes = eventProfile.cutoffAt
    ? new Date(eventProfile.cutoffAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
    : undefined;
  const seam = Math.min(70, Math.max(30, (pYes ?? 0.5) * 100));
  const tPct = Math.min(100, Math.max(0, ((ruler.threshold - ruler.min) / (ruler.max - ruler.min)) * 100));

  function pick(side: "yes" | "no") {
    window.dispatchEvent(new CustomEvent("qt:bet", { detail: side }));
    document.getElementById("trade-ticket")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  const cents = (yes: boolean) => (pYes === undefined ? undefined : Math.round((yes ? pYes : 1 - pYes) * 100));
  const sides = [
    { side: "yes" as const, label: "YES", cond: eventProfile.copy.condYes },
    { side: "no" as const, label: "NO", cond: eventProfile.copy.condNo },
  ];

  return (
    <section className="qb" aria-label="Pick a side" style={{ ["--seam" as string]: `${seam}%`, ["--t" as string]: `${tPct}%` }}>
      <div className="qb__meta mono">
        <span>{eventProfile.copy.metaLabel}</span>
        {closes && <span>Trading closes {closes}</span>}
      </div>

      {settled ? (
        <div className="qb__card qb__card--settled">
          {sides.map(({ side, label, cond }) => {
            const won = (status === 4) === (side === "yes");
            return (
              <div key={side} className={`qb__half qb__half--${side}${won ? " is-won" : " is-lost"}`}>
                <span className="qb__eyebrow mono">{label} · {cond}</span>
                <span className="qb__num">{won ? "$1" : "$0"}</span>
                <span className="qb__cap mono">{won ? "paid per winning share" : "pays nothing"}</span>
                <span className="qb__cta">{won ? "Won" : "Lost"}</span>
              </div>
            );
          })}
          <span className="qb__seam" aria-hidden="true" />
        </div>
      ) : (
      <div className="qb__card">
        {sides.map(({ side, label, cond }) => {
          const real = cents(side === "yes");
          const c = real ?? 50;
          return (
            <button key={side} type="button" className={`qb__half qb__half--${side}${real === undefined ? " is-idle" : ""}`} onClick={() => pick(side)} aria-label={`Buy ${label} at ${c} cents`}>
              <span className="qb__eyebrow mono">{label} · {cond}</span>
              <span className="qb__num">
                {real === undefined ? <>{c}</> : <AnimatedNumber value={String(c)} />}
                <i>¢</i>
              </span>
              <span className="qb__cap mono">{real === undefined ? "opening price · moves once people trade" : "market price per share"}</span>
              <span className="qb__cta">Buy {label} <b aria-hidden="true">→</b></span>
            </button>
          );
        })}
        <span className="qb__seam" aria-hidden="true" />
      </div>
      )}
      {settled && <p className="qb__rule"><Link href="/positions/">Check your claims and redeem →</Link></p>}

      <div className="qb__ruler" aria-hidden="true">
        <div className="qb__track"><i className="qb__no" /><i className="qb__yes" /><span className="qb__notch" /></div>
        <div className="qb__ticks mono">
          <span>{ruler.format(ruler.min)}</span>
          <span className="qb__tmark">{ruler.format(ruler.threshold)} threshold</span>
          <span>{ruler.format(ruler.max)}</span>
        </div>
      </div>

      {!settled && <p className="qb__rule">A share pays <b>$1.00</b> if its side is right and $0 if not, so the price in cents is also the market's chance. Buy at 40¢ and you make 60¢ when you are right.</p>}
    </section>
  );
}
