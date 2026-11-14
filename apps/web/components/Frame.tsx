"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { robinhoodChain } from "@qtimeline/chain";
import { WalletButton } from "@/components/WalletButton";
import { WalletProvider, useWallet } from "@/lib/wallet";

const links = [
  ["Market", "/market/"],
  ["Positions", "/positions/"],
  ["Vote", "/vote/"],
  ["Rules", "/rules/"],
] as const;

/** Tells the visitor, in plain words, what is blocking them: no wallet, wrong network, or a failed connection. */
function WalletNotices() {
  const { wrongChain, switchChain, error, clearError, account } = useWallet();
  if (wrongChain) {
    return (
      <div className="notice notice--warn" role="alert">
        <span>Your wallet is on the wrong network. This app runs on {robinhoodChain.name}.</span>
        <button onClick={() => void switchChain()}>Switch network</button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="notice notice--error" role="alert">
        <span>{error}</span>
        {!account && /No wallet found/.test(error) && <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask ↗</a>}
        <button onClick={clearError} aria-label="Dismiss">✕</button>
      </div>
    );
  }
  return null;
}

export function Frame({ children }: { children: React.ReactNode; wide?: boolean }) {
  return <WalletProvider><FrameInner>{children}</FrameInner></WalletProvider>;
}

function FrameInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const isTestnet = robinhoodChain.id === 46630;
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // Slide a pill under the active nav link, and tighten the header once the page scrolls.
  useLayoutEffect(() => {
    const measure = () => {
      const active = navRef.current?.querySelector<HTMLElement>("a.is-active");
      setPill(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="shell qt-erestyra product-shell product-shell--wide">
      <header className={`topbar ${scrolled ? "topbar--scrolled" : ""}`}>
        <Link className="brand" href="/">
          <svg
            width="16"
            height="14"
            viewBox="0 0 16 14"
            fill="none"
            aria-hidden="true"
            style={{ width: "16px", height: "14px", flexShrink: 0 }}
          >
            <path d="M1 7H6.5L13.5 2" stroke="#CFEF8C" strokeWidth="1.6" strokeLinecap="square" />
            <path d="M6.5 7L13.5 12" stroke="#F3F2EC" strokeWidth="1.6" strokeLinecap="square" />
          </svg>
          <span>QTIMELINE</span>
        </Link>

        <nav className="topbar__nav" aria-label="App navigation" ref={navRef}>
          <span className="topbar__pill" aria-hidden="true" style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width, opacity: 1 } : { opacity: 0 }} />
          {links.map(([label, href]) => {
            const active = pathname === href || pathname.startsWith(href.replace(/\/$/, ""));
            return (
              <Link
                key={href}
                href={href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="topbar__actions">
          <a
            href="https://x.com/QTimelineHook"
            target="_blank"
            rel="noopener noreferrer"
            className="topbar__x"
            aria-label="QTimeline on X"
            title="QTimeline on X"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <span className="net-pill" title={robinhoodChain.name}>
            <span>{isTestnet ? "TESTNET · 46630" : "ROBINHOOD · 4663"}</span>
          </span>
          <WalletButton />
        </div>
      </header>

      <WalletNotices />
      <div className="product-body" key={pathname}>{children}</div>

      <footer className="product-footer">
        <div className="product-footer__brand">
          <span>QTIMELINE</span>
          <small>{isTestnet ? "ROBINHOOD TESTNET · 46630" : "ROBINHOOD CHAIN · 4663"}</small>
        </div>
        <div className="product-footer__links">
          <Link href="/">Overview</Link>
          <Link href="/market/">Market</Link>
          <Link href="/positions/">Positions</Link>
          <Link href="/vote/">Vote</Link>
          <Link href="/rules/">Rules &amp; Risk ↗</Link>
          <a href="https://x.com/QTimelineHook" target="_blank" rel="noopener noreferrer">
            X ↗
          </a>
        </div>
      </footer>
    </main>
  );
}

export type HeadingFact = { label: string; value: React.ReactNode; sub?: string; wide?: boolean };

/** Page hero: title and intro on the left, the page's key facts on the right. */
export function PageHeading({ tag, title, body, facts, note }: { tag: string; title: string; body: string; facts?: HeadingFact[]; note?: React.ReactNode }) {
  return (
    <section className={`phero${facts ? "" : " phero--solo"}`}>
      <div className="phero__copy">
        <p className="phero__tag">{tag}</p>
        <h1>{title}</h1>
        <p className="phero__intro">{body}</p>
        {note && <p className="phero__note">{note}</p>}
      </div>
      {facts && (
        <ul className="fchips" aria-label="At a glance">
          {facts.map((fact) => (
            <li key={fact.label} className={`fchip${fact.wide ? " fchip--lead" : ""}`}>
              <span className="fchip__label">{fact.label}</span>
              <div className="fchip__value">{fact.value}</div>
              {fact.sub && <small>{fact.sub}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
