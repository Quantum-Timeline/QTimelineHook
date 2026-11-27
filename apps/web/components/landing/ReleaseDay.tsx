"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { eventProfile } from "@/lib/event-profile";

const FIVE_MIN = 300;
const TWO_DAYS = 48 * 3600;

const etTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET";

function left(seconds: number) {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

/**
 * The life of one market in four real moments, plus the three ways it can end. The moments come from the on-chain schedule
 * (cutoff, release five minutes later, a 48 hour reporting window), so the same section works for every event.
 */
export function ReleaseDay({ cutoffAt }: { cutoffAt: number }) {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const releaseAt = cutoffAt + FIVE_MIN;
  const deadline = releaseAt + TWO_DAYS;
  const c = eventProfile.copy;
  const steps = [
    { at: cutoffAt, when: etTime(cutoffAt), title: c.relStep1, text: c.relStep1Text },
    { at: releaseAt, when: etTime(releaseAt), title: c.relStep2, text: c.relStep2Text },
    { at: releaseAt, when: "Minutes after", title: c.relStep3, text: c.relStep3Text },
    { at: releaseAt, when: "Then", title: c.relStep4, text: c.relStep4Text },
  ];
  // Which moment is next, so the page can say what the visitor is waiting for.
  const next = now === undefined ? undefined : now < cutoffAt ? { label: "Trading closes in", to: cutoffAt } : now < releaseAt ? { label: `The ${eventProfile.copy.sourceKey ?? "BEA"} publishes in`, to: releaseAt } : now < deadline ? { label: "Reporting window closes in", to: deadline } : undefined;
  const state = (idx: number) => {
    if (now === undefined) return "idle";
    if (idx === 0) return now >= cutoffAt ? "done" : "next";
    if (idx === 1) return now >= releaseAt ? "done" : now >= cutoffAt ? "next" : "idle";
    return now >= releaseAt ? "next" : "idle";
  };

  return (
    <section className="section relday" id="release-day" data-dim="0.55">
      <div className="wrap">
        <p className="eyebrow" data-reveal>
          <span className="eyebrow__n">RELEASE DAY</span>
          {c.relEyebrow}
        </p>
        <h2 className="relday__title display-md" data-reveal>
          {c.relTitle}
        </h2>
        <p className="relday__lead lead" data-reveal>
          {c.relLead}
        </p>

        <div className="relday__grid">
          <ol className="relday__steps" data-reveal>
            {steps.map((step, idx) => (
              <li key={step.title} className={`relday__step relday__step--${state(idx)}`}>
                <span className="relday__when mono">{step.when}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
            <li className="relday__clock mono" aria-live="off">
              {next ? (
                <>
                  <span>{next.label}</span>
                  <b>{left(next.to - (now ?? 0))}</b>
                </>
              ) : now === undefined ? (
                <span>Loading the schedule</span>
              ) : (
                <span>The reporting window has closed</span>
              )}
            </li>
          </ol>

          <div className="relday__ends" data-reveal>
            <p className="relday__ends-cap mono">Three ways it ends</p>
            <article className="relday__end relday__end--yes">
              <span className="mono">{c.relYes}</span>
              <p>YES shares pay $1.00 each. NO shares pay $0.</p>
            </article>
            <article className="relday__end relday__end--no">
              <span className="mono">{c.relNo}</span>
              <p>NO shares pay $1.00 each. YES shares pay $0.</p>
            </article>
            <article className="relday__end relday__end--cancel">
              <span className="mono">No result by {etTime(deadline)}</span>
              <p>Anyone can cancel the market, and every share redeems for $0.50. Nobody is stuck.</p>
            </article>
            <Link href="/market/" className="relday__cta mono" data-cursor>
              Pick a side before {etTime(cutoffAt)} →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
