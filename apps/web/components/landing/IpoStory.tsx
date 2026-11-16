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

const UP = "M0 96 C 40 92, 60 70, 100 66 S 160 60, 200 36 S 250 22, 280 8";
const DOWN = "M0 8 C 40 14, 60 40, 100 44 S 160 62, 200 78 S 250 90, 280 98";

export function IpoStory({ cutoffLabel, threshold }: { cutoffLabel: string; threshold: number }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.dataset.static = "true"; return; }
    const q = <T extends Element>(sel: string) => el.querySelector<T>(sel);
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "none" } });
      // Scene 1: the deposit splits in two
      tl.fromTo(q(".st-coin"), { scale: 1, opacity: 1 }, { scale: 0.9, opacity: 0, duration: 0.5 }, 0.35)
        .fromTo(q(".st-claim--yes"), { x: 0, opacity: 0, scale: 0.8 }, { x: -120, opacity: 1, scale: 1, duration: 0.55 }, 0.35)
        .fromTo(q(".st-claim--no"), { x: 0, opacity: 0, scale: 0.8 }, { x: 120, opacity: 1, scale: 1, duration: 0.55 }, 0.35)
        // Scene 2: both price lines draw, numbers follow
        .fromTo(q(".st-line--up"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.85 }, 1.1)
        .fromTo(q(".st-line--down"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.85 }, 1.1)
        .fromTo(q(".st-tick--up"), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 1.5)
        .fromTo(q(".st-tick--down"), { y: -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 1.5)
        // Scene 3: the clock runs into the cutoff line
        .fromTo(q(".st-clock-fill"), { scaleX: 0 }, { scaleX: 1, duration: 0.8 }, 2.1)
        .fromTo(q(".st-cutoff"), { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.25 }, 2.8)
        .fromTo(q(".st-closed"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.2 }, 2.9)
        // Scene 4: the filing prints a price and one world lights up
        .fromTo(q(".st-doc"), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 3.05)
        .fromTo(q(".st-price"), { opacity: 0.1 }, { opacity: 1, duration: 0.4 }, 3.35)
        .fromTo(q(".st-verdict"), { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.25 }, 3.75)
        // Scene 5: the payout counts up
        .fromTo(q(".st-win"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 }, 4.1)
        .fromTo(q(".st-lose"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 }, 4.2);

      const counter = { v: 0 };
      const payout = q<HTMLElement>(".st-payout");
      tl.fromTo(counter, { v: 0 }, { v: 10, duration: 0.7, onUpdate: () => { if (payout) payout.textContent = `$${counter.v.toFixed(2)}`; } }, 4.25);
      const printed = { v: 0 };
      const price = q<HTMLElement>(".st-price");
      tl.fromTo(printed, { v: 60 }, { v: threshold + 4, duration: 0.45, onUpdate: () => { if (price) price.textContent = `$${printed.v.toFixed(2)}`; } }, 3.35);

      ScrollTrigger.create({
        animation: tl,
        trigger: el,
        start: "top top",
        end: () => `+=${Math.round(window.innerHeight * 5.2)}`,
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
          <div className="st-scene" data-i="0">
            <div className="st-coin"><b>10</b><span className="mono">USDG</span></div>
            <div className="st-claim st-claim--yes"><b>10</b><span className="mono">YES claim</span></div>
            <div className="st-claim st-claim--no"><b>10</b><span className="mono">NO claim</span></div>
          </div>
          <div className="st-scene" data-i="1">
            <div className="st-pair">
              <div className="st-panel st-panel--yes">
                <span className="mono">ETH · YES world</span>
                <svg viewBox="0 0 280 104" preserveAspectRatio="none"><path className="st-line st-line--up" d={UP} pathLength={1} /></svg>
                <b className="st-tick st-tick--up mono">▲ priced in if ≥ ${threshold}</b>
              </div>
              <div className="st-panel st-panel--no">
                <span className="mono">ETH · NO world</span>
                <svg viewBox="0 0 280 104" preserveAspectRatio="none"><path className="st-line st-line--down" d={DOWN} pathLength={1} /></svg>
                <b className="st-tick st-tick--down mono">▼ priced in if &lt; ${threshold}</b>
              </div>
            </div>
          </div>
          <div className="st-scene" data-i="2">
            <div className="st-clock"><i className="st-clock-fill" /><span className="st-cutoff" /></div>
            <div className="st-clock-labels mono"><span>Trading</span><span>{cutoffLabel}</span></div>
            <p className="st-closed mono">Swaps closed on-chain</p>
          </div>
          <div className="st-scene" data-i="3">
            <div className="st-doc">
              <span className="mono">Form 424B4 · price to public</span>
              <b className="st-price">$60.00</b>
              <span className="st-verdict mono">at or above ${threshold.toFixed(2)} → YES resolves</span>
              <small className="mono">Example value for illustration</small>
            </div>
          </div>
          <div className="st-scene" data-i="4">
            <div className="st-pay">
              <div className="st-win"><span className="mono">10 YES claims</span><b className="st-payout">$0.00</b></div>
              <div className="st-lose"><span className="mono">10 NO claims</span><b>$0.00</b></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
