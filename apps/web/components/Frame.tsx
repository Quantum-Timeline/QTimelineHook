"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { robinhoodChain } from "@qtimeline/chain";
import { WalletButton } from "@/components/WalletButton";

const links = [
  ["Market", "/market/"],
  ["Positions", "/positions/"],
  ["Vote", "/vote/"],
  ["Rules", "/rules/"],
] as const;

export function Frame({ children }: { children: React.ReactNode }) {
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
    <main className="shell qt-erestyra product-shell">
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
          <span className="net-pill" title={robinhoodChain.name}>
            <i aria-hidden="true" />
            <span>{isTestnet ? "TESTNET · 46630" : "ROBINHOOD · 4663"}</span>
          </span>
          <WalletButton />
        </div>
      </header>

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
        </div>
      </footer>
    </main>
  );
}

export function PageHeading({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <section className="hero subhero">
      <p className="eyebrow">
        <span>[{tag}]</span>
      </p>
      <h1>{title}</h1>
      <p className="intro">{body}</p>
    </section>
  );
}
