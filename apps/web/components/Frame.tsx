"use client";

import React from "react";
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

  return (
    <main className="shell qt-erestyra product-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand__dot" aria-hidden="true" />
          <span>QTIMELINE</span>
        </Link>

        <nav className="topbar__nav" aria-label="App navigation">
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

      <div className="product-body">{children}</div>

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
        <i aria-hidden="true" />
        <span>{tag}</span>
      </p>
      <h1>{title}</h1>
      <p className="intro">{body}</p>
    </section>
  );
}
