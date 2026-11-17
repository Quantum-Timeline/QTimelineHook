"use client";

import { AnimatedNumber } from "@/lib/motion";
import { useOdds } from "@/lib/odds";
import { eventProfile } from "@/lib/event-profile";

/** The first thing a visitor can do: pick a side. Mirrors the one-tap Yes / No pair people know from other prediction markets. */
export function QuickBet() {
  const { yes: pYes, note } = useOdds();
  const loading = pYes === undefined && note.startsWith("Reading");

  function pick(side: "yes" | "no") {
    window.dispatchEvent(new CustomEvent("qt:bet", { detail: side }));
    document.getElementById("trade-ticket")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  const cents = (yes: boolean) => (pYes === undefined ? undefined : Math.round((yes ? pYes : 1 - pYes) * 100));
  const sides = [
    { side: "yes" as const, label: "YES", sub: eventProfile.yesLabel.replace(/^YES\s*·\s*/, "") },
    { side: "no" as const, label: "NO", sub: eventProfile.noLabel.replace(/^NO\s*·\s*/, "") },
  ];

  return (
    <section className="quickbet" aria-label="Pick a side">
      <div className="quickbet__row">
        {sides.map(({ side, label, sub }) => {
          const c = cents(side === "yes");
          return (
            <button key={side} type="button" className={`quickbet__btn quickbet__btn--${side}`} onClick={() => pick(side)}>
              <span className="quickbet__side">Buy {label}</span>
              <span className="quickbet__price">
                {c === undefined ? (loading ? "…" : "—") : <AnimatedNumber value={String(c)} />}
                <i>{c === undefined ? "" : "¢"}</i>
              </span>
              <span className="quickbet__sub">{sub}</span>
            </button>
          );
        })}
      </div>
      <p className="quickbet__rule">The price in cents is the market's chance for that side. A share bought at <b>40¢</b> pays <b>$1.00</b> if you are right.</p>
    </section>
  );
}
