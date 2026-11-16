"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  { key: "Split", title: "Lock USDG. Get two claims.", text: "Deposit USDG in the vault and receive the same amount of YES and NO claims. Merge them back any time before the result." },
  { key: "Trade", title: "Each world has its own ETH.", text: "ETH-YES and ETH-NO are separate Uniswap v4 pools. Trade the one that matches what you expect the IPO price to do." },
  { key: "Close", title: "Swaps stop before pricing.", text: "The hook shuts every pool on-chain before the offering is priced, so nobody trades with the answer in hand." },
  { key: "Resolve", title: "The 424B4 decides.", text: "The bot reads the final offering price from the SEC filing. The report needs both an ECDSA and an ML-DSA-44 signature." },
  { key: "Redeem", title: "Winners redeem 1 for 1.", text: "The winning claim pays one USDG. The other pays nothing. With no result after 48 hours, each claim redeems for half." },
] as const;

const UP = "M0 96 C 30 94, 50 78, 80 72 S 120 74, 150 52 S 210 40, 240 22 S 266 12, 280 8";
const DOWN = "M0 8 C 30 12, 50 30, 80 36 S 120 34, 150 56 S 210 70, 240 84 S 266 94, 280 98";
const TICKS = Array.from({ length: 13 });

type Props = { cutoffLabel: string; threshold: number };

export function IpoStory({ cutoffLabel, threshold }: Props) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.dataset.static = "true"; return; }
    const q = <T extends Element>(sel: string) => el.querySelector<T>(sel);
    const qa = (sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
    const counter = (target: HTMLElement | null, from: number, to: number, fmt: (v: number) => string) => {
      const state = { v: from };
      return gsap.fromTo(state, { v: from }, { v: to, duration: 0.5, ease: "none", onUpdate: () => { if (target) target.textContent = fmt(state.v); } });
    };
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "none" } });
      const money = (v: number) => v.toFixed(2);

      // 0 · Split
      tl.fromTo(q(".s1-vault"), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2 }, 0.02)
        .fromTo(qa(".s1-dot"), { y: -6, opacity: 0 }, { y: 6, opacity: 1, duration: 0.25, stagger: 0.04 }, 0.18)
        .fromTo(qa(".s1-claim"), { y: 26, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, stagger: 0.06 }, 0.3)
        .fromTo(qa(".s1-claim .s1-bar i"), { scaleX: 0 }, { scaleX: 1, duration: 0.35, stagger: 0.06 }, 0.4)
        .fromTo(q(".s1-eq"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2 }, 0.7)
        .add(counter(q(".s1-num--yes"), 0, 10, money), 0.34)
        .add(counter(q(".s1-num--no"), 0, 10, money), 0.4);

      // 1 · Trade
      tl.fromTo(qa(".s2-panel"), { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, stagger: 0.05 }, 1.02)
        .fromTo(qa(".s2-line"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.55 }, 1.14)
        .fromTo(qa(".s2-area"), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1.5)
        .fromTo(qa(".s2-dot"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12 }, 1.62)
        .fromTo(qa(".s2-bar"), { scaleY: 0 }, { scaleY: 1, duration: 0.25, stagger: 0.015 }, 1.2)
        .fromTo(q(".s2-odds"), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2 }, 1.55)
        .fromTo(q(".s2-odds-yes"), { width: "30%" }, { width: "55%", duration: 0.28 }, 1.65)
        .add(counter(q(".s2-pct-yes"), 30, 55, (v) => `${Math.round(v)}%`), 1.65)
        .add(counter(q(".s2-pct-no"), 70, 45, (v) => `${Math.round(v)}%`), 1.65);

      // 2 · Close
      tl.fromTo(q(".s3-clockwrap"), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.15 }, 2.02)
        .fromTo(q(".s3-fill"), { scaleX: 0 }, { scaleX: 1, duration: 0.6 }, 2.1)
        .fromTo(qa(".s3-tick"), { opacity: 0.15 }, { opacity: 1, duration: 0.05, stagger: 0.04 }, 2.1)
        .add(counter(q(".s3-clock"), 48, 0, (v) => `T−${String(Math.floor(v)).padStart(2, "0")}:${String(Math.floor((v % 1) * 60)).padStart(2, "0")}:00`), 2.1)
        .fromTo(qa(".s3-pool"), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.15, stagger: 0.04 }, 2.15)
        .fromTo(qa(".s3-open"), { opacity: 1 }, { opacity: 0, duration: 0.05, stagger: 0.07 }, 2.72)
        .fromTo(qa(".s3-lock"), { opacity: 0 }, { opacity: 1, duration: 0.05, stagger: 0.07 }, 2.72)
        .fromTo(q(".s3-code"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.15 }, 2.85);

      // 3 · Resolve
      tl.fromTo(q(".s4-doc"), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2 }, 3.02)
        .fromTo(qa(".s4-skel i"), { scaleX: 0 }, { scaleX: 1, duration: 0.2, stagger: 0.04 }, 3.12)
        .add(counter(q(".s4-price"), 60, threshold + 4, (v) => `$${v.toFixed(2)}`), 3.3)
        .fromTo(q(".s4-scale"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.15 }, 3.4)
        .fromTo(q(".s4-marker"), { left: "10%" }, { left: `${((threshold + 4 - 50) / 60) * 100}%`, duration: 0.3 }, 3.5)
        .fromTo(qa(".s4-sig"), { y: 12, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.14, stagger: 0.08 }, 3.72)
        .fromTo(q(".s4-verdict"), { opacity: 0 }, { opacity: 1, duration: 0.12 }, 3.88);

      // 4 · Redeem
      tl.fromTo(qa(".s5-row"), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, stagger: 0.07 }, 4.02)
        .fromTo(qa(".s5-arrow"), { scaleX: 0 }, { scaleX: 1, duration: 0.25, stagger: 0.07 }, 4.12)
        .add(counter(q(".s5-win"), 0, 10, (v) => `$${money(v)}`), 4.2)
        .fromTo(q(".s5-cancel"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.18 }, 4.55)
        .fromTo(q(".s5-done"), { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.15 }, 4.75);

      tl.fromTo(q(".ss-progress b"), { scaleX: 0 }, { scaleX: 1, duration: 5 }, 0);
      tl.set({}, {}, 5);

      ScrollTrigger.create({
        animation: tl,
        trigger: el,
        start: "top top",
        end: () => `+=${Math.round(window.innerHeight * 5.6)}`,
        pin: true,
        scrub: 0.6,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => { el.dataset.step = String(Math.min(4, Math.floor(self.progress * 5))); },
      });
    }, el);
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [threshold]);

  return (
    <section className="section story" id="story" data-step="0" ref={root}>
      <div className="wrap story__inner">
        <div className="story__copy">
          <p className="eyebrow"><span className="eyebrow__n">FLOW</span>One market, start to payout</p>
          <ol className="story__rail" aria-label="Steps">
            {STEPS.map((s, i) => <li key={s.key} data-i={i}><span className="mono">0{i + 1}</span>{s.key}</li>)}
          </ol>
          <div className="story__texts">
            {STEPS.map((s, i) => (
              <div key={s.key} className="story__text" data-i={i}>
                <h2 className="display-md">{s.title}</h2>
                <p className="lead">{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="story__screen" aria-hidden="true">
          <header className="ss-bar mono">
            <span>ANT-IPO-PRICE-2026-11</span>
            <span className="ss-steps">{STEPS.map((s, i) => <em key={s.key} data-i={i}>Step 0{i + 1} / 05 · {s.key}</em>)}</span>
          </header>

          <div className="ss-body">
            {/* 0 · Split */}
            <div className="st-scene" data-i="0">
              <div className="s1-vault">
                <span className="mono">Vault deposit</span>
                <div><i className="tok tok--usd">$</i><b>10.00</b><em className="mono">USDG</em></div>
                <small className="mono">Locked 1 : 1 as collateral</small>
              </div>
              <div className="s1-flow">{Array.from({ length: 5 }).map((_, i) => <i key={i} className="s1-dot" />)}</div>
              <div className="s1-pair">
                <div className="s1-claim s1-claim--yes">
                  <span className="mono"><i className="tok tok--yes">Y</i>YES claim</span>
                  <b className="s1-num s1-num--yes">0.00</b>
                  <small>Pays 1 USDG if the price is ≥ ${threshold}</small>
                  <span className="s1-bar"><i /></span>
                </div>
                <div className="s1-claim s1-claim--no">
                  <span className="mono"><i className="tok tok--no">N</i>NO claim</span>
                  <b className="s1-num s1-num--no">0.00</b>
                  <small>Pays 1 USDG if the price is &lt; ${threshold}</small>
                  <span className="s1-bar"><i /></span>
                </div>
              </div>
              <p className="s1-eq mono">1 YES + 1 NO = 1 USDG · merge back before the result</p>
            </div>

            {/* 1 · Trade */}
            <div className="st-scene" data-i="1">
              <div className="s2-pair">
                {([["yes", "ETH · YES world", UP, "+8.4%"], ["no", "ETH · NO world", DOWN, "−6.1%"]] as const).map(([side, label, path, delta]) => (
                  <div key={side} className={`s2-panel s2-panel--${side}`}>
                    <div className="s2-head"><span className="mono">{label}</span><em className="mono">0.30% fee</em></div>
                    <div className="s2-chart">
                      <svg viewBox="0 0 280 104" preserveAspectRatio="none">
                        <defs><linearGradient id={`g-${side}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={side === "yes" ? "#cfef8c" : "#ff8f7a"} stopOpacity="0.32" /><stop offset="1" stopColor={side === "yes" ? "#cfef8c" : "#ff8f7a"} stopOpacity="0" /></linearGradient></defs>
                        {[26, 52, 78].map((y) => <line key={y} x1="0" x2="280" y1={y} y2={y} className="s2-grid" />)}
                        <path className="s2-area" d={`${path} L280 104 L0 104 Z`} fill={`url(#g-${side})`} />
                        <path className="s2-line" d={path} pathLength={1} />
                      </svg>
                      <i className="s2-dot" />
                      <b className="s2-chip mono">{delta}</b>
                    </div>
                    <div className="s2-vol">{Array.from({ length: 22 }).map((_, i) => <i key={i} className="s2-bar" style={{ height: `${28 + ((i * 37) % 62)}%` }} />)}</div>
                    <div className="s2-stats mono"><span>Range −20% / +25%</span><span>Uniswap v4</span></div>
                  </div>
                ))}
              </div>
              <div className="s2-odds">
                <div className="s2-odds-head mono"><span>YES / NO odds pool · 35–65%</span><span>Illustrative prices</span></div>
                <div className="s2-odds-track"><i className="s2-odds-yes" /></div>
                <div className="s2-odds-labels mono"><span>YES <b className="s2-pct-yes">30%</b></span><span>NO <b className="s2-pct-no">70%</b></span></div>
              </div>
            </div>

            {/* 2 · Close */}
            <div className="st-scene" data-i="2">
              <div className="s3-clockwrap">
                <div className="s3-top"><span className="mono">Time to cutoff</span><b className="s3-clock mono">T−48:00:00</b></div>
                <div className="s3-bar">
                  <i className="s3-fill" />
                  <div className="s3-ticks">{TICKS.map((_, i) => <i key={i} className="s3-tick" />)}</div>
                </div>
                <div className="s3-labels mono"><span>Market open</span><span>Cutoff · {cutoffLabel}</span></div>
              </div>
              <div className="s3-pools">
                {["ETH-YES", "ETH-NO", "YES / NO odds"].map((name, i) => (
                  <div key={name} className="s3-pool">
                    <span className="mono">Pool {i + 1}</span><b>{name}</b>
                    <em className="s3-state mono"><span className="s3-open">Open</span><span className="s3-lock">Locked</span></em>
                  </div>
                ))}
              </div>
              <p className="s3-code mono">beforeSwap → revert MarketClosed()</p>
            </div>

            {/* 3 · Resolve */}
            <div className="st-scene" data-i="3">
              <div className="s4-doc">
                <div className="s4-head mono"><span>SEC EDGAR · Form 424B4</span><span>Anthropic, PBC · Nasdaq: ANT</span></div>
                <div className="s4-skel"><i style={{ width: "92%" }} /><i style={{ width: "78%" }} /><i style={{ width: "64%" }} /></div>
                <div className="s4-row"><span className="mono">Initial public offering price per share</span><b className="s4-price">$60.00</b></div>
              </div>
              <div className="s4-scale">
                <div className="s4-track"><i className="s4-no" style={{ width: `${((threshold - 50) / 60) * 100}%` }} /><i className="s4-yes" /><span className="s4-mark mono" style={{ left: `${((threshold - 50) / 60) * 100}%` }}>${threshold}</span><span className="s4-marker" /></div>
                <div className="s4-ends mono"><span>$50</span><span>$110</span></div>
              </div>
              <div className="s4-sigs">
                <span className="s4-sig mono"><i>✓</i>ECDSA</span>
                <span className="s4-sig mono"><i>✓</i>ML-DSA-44</span>
                <span className="s4-verdict mono">Resolves YES · example value</span>
              </div>
            </div>

            {/* 4 · Redeem */}
            <div className="st-scene" data-i="4">
              <div className="s5-row s5-row--win">
                <span className="s5-who"><i className="tok tok--yes">Y</i><b>10 YES claims</b><small className="mono">winning side</small></span>
                <i className="s5-arrow" />
                <b className="s5-win">$0.00</b>
              </div>
              <div className="s5-row s5-row--lose">
                <span className="s5-who"><i className="tok tok--no">N</i><b>10 NO claims</b><small className="mono">other side</small></span>
                <i className="s5-arrow" />
                <b>$0.00</b>
              </div>
              <div className="s5-cancel mono"><span>If cancelled or no result in 48 h</span><b>every claim → $0.50</b></div>
              <p className="s5-done mono">✓ Redeemed to your wallet · 1 : 1</p>
            </div>
          </div>

          <footer className="ss-foot mono">
            <span>Robinhood Chain · 4663</span>
            <i className="ss-progress"><b /></i>
            <span>Uniswap v4 hook</span>
          </footer>
        </div>
      </div>
    </section>
  );
}
