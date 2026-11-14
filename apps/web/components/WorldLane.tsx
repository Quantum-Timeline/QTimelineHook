"use client";

import { ClaimIcon, PoolPair } from "@/components/TokenLogo";
import { AnimatedNumber } from "@/lib/motion";
import { useOdds } from "@/lib/odds";

/** One side of the fork: its implied odds, claim tokens, and a shortcut that sets the trade ticket to this world. */
export function WorldLane({ yes, label }: { yes: boolean; label: string }) {
  const { yes: pYes, note } = useOdds();
  const pct = pYes === undefined ? undefined : (yes ? pYes : 1 - pYes) * 100;

  function choose() {
    window.dispatchEvent(new CustomEvent("qt:outcome", { detail: yes ? "yes" : "no" }));
    document.getElementById("trade-ticket")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  return (
    <article className={`world world--${yes ? "yes" : "no"}`}>
      <div className="world__top">
        <PoolPair a="ETH" b="USDG" yesA={yes} yesB={yes} size={40} />
        <span className="world__name">{label}</span>
      </div>
      <div className={`world__odds${pct === undefined ? " world__odds--na" : ""}`}>
        <b>{pct === undefined ? (note.startsWith("Reading") ? "…" : "Soon") : <AnimatedNumber value={pct.toFixed(0)} />}</b>
        <span>{pct === undefined ? "" : "%"}</span>
      </div>
      <p className="world__caption">{yes ? "chance the market assigns to YES" : "chance the market assigns to NO"}</p>
      <div className="world__bar" aria-hidden="true"><i style={{ width: `${pct ?? 0}%` }} /></div>
      <dl className="world__facts">
        <div><dt>If {yes ? "YES" : "NO"} resolves</dt><dd>{yes ? "YES" : "NO"} claims pay 1 : 1</dd></div>
        <div><dt>If {yes ? "NO" : "YES"} resolves</dt><dd>{yes ? "YES" : "NO"} claims pay nothing</dd></div>
        <div><dt>If cancelled</dt><dd>50% per claim</dd></div>
      </dl>
      <button type="button" className="world__cta" onClick={choose}>
        <ClaimIcon asset="ETH" yes={yes} size={22} />
        Trade the {yes ? "YES" : "NO"} world
        <span aria-hidden="true">→</span>
      </button>
      <small className="world__note">{note}</small>
    </article>
  );
}
