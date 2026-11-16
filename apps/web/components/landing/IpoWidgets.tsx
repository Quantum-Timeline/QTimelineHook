"use client";
import { useEffect, useState } from "react";
import { eventProfile } from "@/lib/event-profile";

const pad = (n: number) => String(n).padStart(2, "0");

/** Counts down to the on-chain trading cutoff. Digits only; no animation beyond the tick. */
export function IpoCountdown({ cutoffAt }: { cutoffAt: number }) {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = now === undefined ? undefined : Math.max(0, cutoffAt - Math.floor(now / 1000));
  const parts = left === undefined ? undefined : [
    [Math.floor(left / 86400), "days"],
    [Math.floor((left % 86400) / 3600), "hrs"],
    [Math.floor((left % 3600) / 60), "min"],
    [left % 60, "sec"],
  ] as const;
  const when = new Date(cutoffAt * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const threshold = Number(process.env.NEXT_PUBLIC_IPO_THRESHOLD) || 74;
  return (
    <aside className="ipo-count" role="timer" aria-label="Time until trading closes">
      <div className="ipo-count__top mono"><span>Trading closes</span><span>Anthropic IPO · ANT</span></div>
      {left === 0 ? (
        <strong className="ipo-count__done">Waiting for the Form 424B4</strong>
      ) : (
        <div className="ipo-count__digits" aria-hidden="true">
          {(parts ?? [["--", "days"], ["--", "hrs"], ["--", "min"], ["--", "sec"]]).map(([value, unit]) => (
            <span key={unit}><b>{typeof value === "number" ? pad(value) : value}</b><i>{unit}</i></span>
          ))}
        </div>
      )}
      <div className="ipo-count__foot mono"><span>{when} UTC</span><span>Threshold ${threshold.toFixed(2)}</span></div>
    </aside>
  );
}

const STACK = [
  { name: "Robinhood Chain", note: "Chain 4663", icon: "/partners/robinhood.svg" },
  { name: "Uniswap v4", note: "Hooks + 3 pools", glyph: "v4" },
  { name: "Ethereum", note: "ETH collateral", icon: "/partners/ethereum.svg" },
  { name: "USDG", note: "Settlement asset", icon: "/tokens/usdg.png", photo: true },
  { name: "SEC EDGAR", note: "Form 424B4", glyph: "SEC" },
  { name: "NIST FIPS 204", note: "ML-DSA-44", glyph: "PQ" },
] as const;

/** The pieces the market is built on, as a quiet row of marks under the hero copy. */
export function IpoStack() {
  return (
    <ul className="ipo-stack" aria-label="Built with">
      {STACK.map((item) => (
        <li key={item.name}>
          <span className={`ipo-stack__mark${"photo" in item ? " is-photo" : ""}`} aria-hidden="true">
            {"icon" in item ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={item.icon} alt="" width={20} height={20} /> : <b className="mono">{item.glyph}</b>}
          </span>
          <span className="ipo-stack__text"><b>{item.name}</b><i className="mono">{item.note}</i></span>
        </li>
      ))}
    </ul>
  );
}

const MIN = 50;
const MAX = 110;

/** Drag the final offer price and watch which world pays. The threshold comes from the build profile. */
export function IpoScrubber() {
  const threshold = Number(process.env.NEXT_PUBLIC_IPO_THRESHOLD) || 74;
  const [price, setPrice] = useState(threshold);
  const yes = price >= threshold;
  const pct = ((price - MIN) / (MAX - MIN)) * 100;
  const thresholdPct = ((threshold - MIN) / (MAX - MIN)) * 100;
  const money = (n: number) => `$${n.toFixed(2)}`;
  return (
    <section className="section scrub" id="scrub" data-world={yes ? "yes" : "no"}>
      <div className="wrap">
        <p className="eyebrow" data-reveal><span className="eyebrow__n">SCRUB</span>Settle it yourself</p>
        <h2 className="scrub__title display-md" data-reveal>Set the final price.<br />See which world pays.</h2>
        <div className="scrub__stage">
          <div className="scrub__read">
            <span className="mono scrub__cap">Final offer price in the Form 424B4</span>
            <output className="scrub__price" htmlFor="scrub-range">{money(price)}</output>
            <span className="scrub__verdict mono">{yes ? `At or above ${money(threshold)} · YES resolves` : `Below ${money(threshold)} · NO resolves`}</span>
          </div>
          <div className="scrub__track" style={{ ["--p" as string]: `${pct}%`, ["--t" as string]: `${thresholdPct}%` }}>
            <div className="scrub__bar"><i className="scrub__no" /><i className="scrub__yes" /></div>
            <span className="scrub__mark mono">{money(threshold)}</span>
            <input id="scrub-range" type="range" min={MIN} max={MAX} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} aria-label="Final IPO price in dollars" />
            <div className="scrub__ends mono"><span>{money(MIN)}</span><span>{money(MAX)}</span></div>
          </div>
          <div className="scrub__pay">
            <div className={`scrub__claim${yes ? " is-win" : ""}`}><span className="mono">YES claim</span><b>{yes ? "$1.00" : "$0.00"}</b><small>{eventProfile.yesLabel}</small></div>
            <div className={`scrub__claim${yes ? "" : " is-win"}`}><span className="mono">NO claim</span><b>{yes ? "$0.00" : "$1.00"}</b><small>{eventProfile.noLabel}</small></div>
          </div>
        </div>
        <p className="scrub__note">Each claim redeems for 1 USDG on the winning side and nothing on the other. If no result is reported within 48 hours, every claim redeems for $0.50.</p>
      </div>
    </section>
  );
}
