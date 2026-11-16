"use client";
import { useEffect, useRef, useState } from "react";

const STAGES = [
  { key: "Watch", fn: "EDGAR poller", text: "A scheduled bot polls SEC EDGAR for Anthropic's first Form 424B4." },
  { key: "Parse", fn: "evidence.json", text: "It reads the price per share, converts it to cents and hashes the evidence." },
  { key: "Sign", fn: "ECDSA + ML-DSA-44", text: "The report digest is signed twice: classical and post-quantum." },
  { key: "Verify", fn: "IpoResolutionAdapter", text: "The adapter checks both signatures on-chain through MLDSA44Verifier." },
  { key: "Final", fn: "IpoMarketRegistry", text: "The registry flips to YES or NO. Redemption opens at 1 : 1." },
] as const;

const LOG: ReadonlyArray<ReadonlyArray<string>> = [
  ["edgar.poll form=424B4 issuer=\"Anthropic, PBC\"", "filing found: Form 424B4"],
  ["parse price_per_share → 78.00 USD", "price_cents = 7800", "evidence → keccak256 → 0x7f3a…c91e"],
  ["sign ECDSA secp256k1 ✓", "sign ML-DSA-44 · FIPS 204 ✓"],
  ["adapter.report(periodId, 7800, evidence)", "MLDSA44Verifier.verify → true", "resolver key matches PQKeyRegistry ✓"],
  ["registry.status → FinalYes · 7800 ≥ 7400", "redeem() open · winners 1 : 1"],
];

const CYCLE = 9;

export function IpoTerminal({ threshold, cutoffLabel }: { threshold: number; cutoffLabel: string }) {
  const root = useRef<HTMLElement>(null);
  const [t, setT] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const prefers = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(prefers);
    if (prefers) { setT(6); return; }
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || reduced) return;
    const timer = window.setInterval(() => setT((n) => n + 1), 1700);
    return () => window.clearInterval(timer);
  }, [visible, reduced]);

  const phase = reduced ? 6 : t % CYCLE;
  const step = Math.max(-1, Math.min(4, phase - 1));
  const lines = LOG.flatMap((group, i) => (i <= step ? group.map((text) => ({ i, text })) : [])).slice(-8);
  const cents = threshold * 100 + 400;
  const field = (from: number, value: string) => (step >= from ? value : "—");

  return (
    <section className="section term" id="resolution" ref={root}>
      <div className="wrap">
        <p className="eyebrow" data-reveal><span className="eyebrow__n">ORACLE</span>Resolution pipeline</p>
        <h2 className="term__title display-md" data-reveal>From SEC filing<br />to on-chain payout.</h2>
        <p className="term__lead lead" data-reveal>A bot reads one filing, signs it twice, and the contracts check both signatures before anything settles.</p>

        <div className="term__console" data-reveal>
          <header className="term__bar mono">
            <span>ANT-IPO-PRICE-2026-11</span>
            <span>Robinhood Chain · 4663</span>
            <span className="term__sim">Illustrative run</span>
          </header>

          <div className="term__grid">
            <ol className="term__stages" aria-label="Pipeline stages">
              {STAGES.map((s, i) => {
                const state = i < step ? "done" : i === step ? "run" : "idle";
                return (
                  <li key={s.key} data-state={state}>
                    <span className="term__n mono">0{i + 1}</span>
                    <div>
                      <b>{s.key}</b>
                      <p>{s.text}</p>
                      <i className="term__fn mono">{s.fn}</i>
                    </div>
                    <em className="term__chip mono">{state === "done" ? "Done" : state === "run" ? "Running" : "Waiting"}</em>
                    <span className="term__prog" aria-hidden="true"><u /></span>
                  </li>
                );
              })}
            </ol>

            <div className="term__side">
              <div className="term__log" aria-hidden="true">
                <span className="term__cap mono">Watcher log</span>
                <ul>
                  {step < 0 ? <li className="is-idle mono"><i>$</i> edgar.poll · no 424B4 yet · next poll in 15:00</li> : null}
                  {lines.map((line, k) => (
                    <li key={`${line.i}-${line.text}`} className="mono" style={{ opacity: 0.45 + (k / Math.max(1, lines.length - 1)) * 0.55 }}><i>$</i> {line.text}</li>
                  ))}
                </ul>
              </div>

              <dl className="term__report">
                <span className="term__cap mono">Report</span>
                <div><dt className="mono">periodId</dt><dd className="mono">ANT-IPO-PRICE-2026-11</dd></div>
                <div><dt className="mono">threshold</dt><dd className="mono">{threshold * 100} ¢</dd></div>
                <div><dt className="mono">price</dt><dd className="mono" data-set={step >= 1}>{field(1, `${cents} ¢`)}</dd></div>
                <div><dt className="mono">evidenceHash</dt><dd className="mono" data-set={step >= 1}>{field(1, "0x7f3a…c91e")}</dd></div>
                <div><dt className="mono">ecdsa</dt><dd className="mono" data-set={step >= 2}>{field(2, "valid")}</dd></div>
                <div><dt className="mono">ml-dsa-44</dt><dd className="mono" data-set={step >= 2}>{field(2, "valid")}</dd></div>
                <div><dt className="mono">on-chain check</dt><dd className="mono" data-set={step >= 3}>{field(3, "passed")}</dd></div>
                <div><dt className="mono">outcome</dt><dd className="mono term__out" data-set={step >= 4}>{field(4, "YES")}</dd></div>
              </dl>
            </div>
          </div>

          <footer className="term__foot mono">
            <span>Trading stops {cutoffLabel} UTC</span>
            <span>No report in 48 h → every claim redeems for 50%</span>
          </footer>
        </div>
      </div>
    </section>
  );
}
