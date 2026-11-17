"use client";

import { AnimatedNumber } from "@/lib/motion";
import { useOdds } from "@/lib/odds";
import { eventProfile } from "@/lib/event-profile";

const MIN = 50;
const MAX = 110;

/**
 * One card, two sides. The seam sits at the market's price: the side the crowd favours is the wider one.
 * Each half is a button that sets the ticket below. The ruler underneath places the threshold on the price line.
 */
export function QuickBet() {
  const { yes: pYes } = useOdds();
  const threshold = Number(process.env.NEXT_PUBLIC_IPO_THRESHOLD) || 74;
  const closes = eventProfile.cutoffAt
    ? new Date(eventProfile.cutoffAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
    : undefined;
  const seam = Math.min(70, Math.max(30, (pYes ?? 0.5) * 100));
  const tPct = ((threshold - MIN) / (MAX - MIN)) * 100;
  const money = (n: number) => `$${n.toFixed(2)}`;

  function pick(side: "yes" | "no") {
    window.dispatchEvent(new CustomEvent("qt:bet", { detail: side }));
    document.getElementById("trade-ticket")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  const cents = (yes: boolean) => (pYes === undefined ? undefined : Math.round((yes ? pYes : 1 - pYes) * 100));
  const sides = [
    { side: "yes" as const, label: "YES", cond: `Final price ≥ ${money(threshold)}` },
    { side: "no" as const, label: "NO", cond: `Final price < ${money(threshold)}` },
  ];

  return (
    <section className="qb" aria-label="Pick a side" style={{ ["--seam" as string]: `${seam}%`, ["--t" as string]: `${tPct}%` }}>
      <div className="qb__meta mono">
        <span>Anthropic IPO · Form 424B4</span>
        {closes && <span>Trading closes {closes}</span>}
      </div>

      <div className="qb__card">
        {sides.map(({ side, label, cond }) => {
          const c = cents(side === "yes");
          return (
            <button key={side} type="button" className={`qb__half qb__half--${side}`} onClick={() => pick(side)} aria-label={`Buy ${label}${c === undefined ? "" : ` at ${c} cents`}`}>
              <span className="qb__eyebrow mono">{label} · {cond}</span>
              <span className="qb__num">
                {c === undefined ? <em>––</em> : <AnimatedNumber value={String(c)} />}
                {c !== undefined && <i>¢</i>}
              </span>
              <span className="qb__cap mono">{c === undefined ? "price appears once trading opens" : "market price per share"}</span>
              <span className="qb__cta">Buy {label} <b aria-hidden="true">→</b></span>
            </button>
          );
        })}
        <span className="qb__seam" aria-hidden="true" />
      </div>

      <div className="qb__ruler" aria-hidden="true">
        <div className="qb__track"><i className="qb__no" /><i className="qb__yes" /><span className="qb__notch" /></div>
        <div className="qb__ticks mono">
          <span>{money(MIN)}</span>
          <span className="qb__tmark">{money(threshold)} threshold</span>
          <span>{money(MAX)}</span>
        </div>
      </div>

      <p className="qb__rule">A share pays <b>$1.00</b> if its side is right and $0 if not, so the price in cents is also the market's chance. Buy at 40¢ and you make 60¢ when you are right.</p>
    </section>
  );
}
