import React from "react";
import { eventProfile } from "@/lib/event-profile";
import Link from "next/link";
import Scene from "@/components/landing/Scene";
import SmoothScroll from "@/components/landing/SmoothScroll";
import { Cursor, Loader } from "@/components/landing/LoaderAndCursor";
import Header from "@/components/landing/Header";
import "@/app/landing.css";

function SplitHeading({
  text,
  as: Tag = "h2",
  className,
}: {
  text: string;
  as?: "h2" | "h3";
  className: string;
}) {
  const words = text.split(" ");
  return (
    <Tag className={className} aria-label={text}>
      {words.map((word, i) => (
        <React.Fragment key={i}>
          <span className="w" aria-hidden="true">
            <span className="wi">{word}</span>
          </span>{" "}
        </React.Fragment>
      ))}
    </Tag>
  );
}

const MANIFESTO_TEXT =
  eventProfile.copy.manifesto;

const MARQUEE_PHRASE = "One Event · Two Timelines";

const ARCHITECTURE_ITEMS = [
  {
    slug: "vault",
    index: "VLT",
    kindLabel: "Custody",
    icon: "custodia-de-criptoactivos",
    name: "OutcomeVault",
    label: "Split USDG into equal YES and NO claims, merge pairs pre-resolution, or redeem winners 1:1.",
    href: "/market/",
  },
  {
    slug: "pools",
    index: "V4",
    kindLabel: "Liquidity",
    icon: "redes-blockchain",
    name: "Three v4 Pools",
    label: "Coupled ETH-YES, ETH-NO, and YES/NO concentrated liquidity pools with 0.30% LP fees.",
    href: "/market/",
  },
  {
    slug: "hook",
    index: "HOOK",
    kindLabel: "Cutoff",
    icon: "soluciones-blockchain",
    name: "TimelineHook",
    label: eventProfile.id === "ipo" ? "On-chain beforeSwap guard halts all three pools at the cutoff, before the offering is priced." : "On-chain beforeSwap guard halts all three pools at 13:25 UTC—five minutes before release.",
    href: "/rules/",
  },
  {
    slug: "oracle",
    index: "PQ",
    kindLabel: "Security",
    icon: "consultoria-blockchain",
    name: "ML-DSA-44 Oracle",
    label: eventProfile.copy.oracleCard,
    href: "/rules/",
  },
  {
    slug: "qtl",
    index: "QTL",
    kindLabel: "Governance",
    icon: "tokenizacion-de-activos",
    name: "$QTL Voting",
    label: eventProfile.id === "ipo" ? "Hold $QTL to nominate the next event and vote on which market launches across 24h cycles." : "Hold $QTL to nominate macro triggers and vote on the next market across 24h cycles.",
    href: "/vote/",
  },
];

const POOL_MODULES = [
  {
    index: "ETH·Y",
    prefix: "ETH — ",
    bold: "YES",
    label: eventProfile.copy.ethYes,
    cta: "Trade Pool",
    href: "/market/",
  },
  {
    index: "ETH·N",
    prefix: "ETH — ",
    bold: "NO",
    label: eventProfile.copy.ethNo,
    cta: "Trade Pool",
    href: "/market/",
  },
  {
    index: "Y/N",
    prefix: "YES / ",
    bold: "NO",
    label: "Direct implied probability curve in USDG claims across a 35%–65% active seed band.",
    cta: "Price Odds",
    href: "/market/",
  },
  {
    index: "1:1",
    prefix: "Outcome",
    bold: "Vault",
    label: "Atomic split, binary-searched exit + merge, and 1:1 post-settlement redemption.",
    cta: "Positions",
    href: "/positions/",
  },
];

const FIGURES_ITEMS = [
  { count: 4663, symbol: null, unit: "CHAIN", caption: "Robinhood Chain L2 network deployment" },
  { count: 3, symbol: null, unit: "POOLS", caption: "Coupled Uniswap v4 pools per market" },
  { count: 300, symbol: null, unit: "SEC", caption: eventProfile.copy.lockCaption },
  { count: 48, symbol: null, unit: "HRS", caption: "Reporting deadline before 50/50 cancel" },
];

const LIFECYCLE_ROWS = [
  {
    n: "SPLIT",
    kicker: "Collateral",
    title: "Mint YES & NO claims",
    text: "Deposit USDG into OutcomeVault via TimelineRouter to receive equal quantities of conditional YES and NO claims.",
  },
  {
    n: "SWAP",
    kicker: "Discovery",
    title: "Trade parallel worlds",
    text: eventProfile.id === "ipo" ? "Swap across ETH-YES, ETH-NO, and YES/NO on Uniswap v4 to trade your view on the IPO price together with ETH." : "Swap across ETH-YES, ETH-NO, and YES/NO on Uniswap v4 to express correlated macro and ETH directional views.",
  },
  {
    n: "LOCK",
    kicker: eventProfile.copy.lockKicker,
    title: "Deterministic cutoff",
    text: eventProfile.copy.lockText,
  },
  {
    n: "SIGN",
    kicker: "Attestation",
    title: "Dual ECDSA + ML-DSA-44",
    text: "PostQuantumResolver requires both a classical ECDSA signature and a FIPS 204 ML-DSA-44 lattice signature.",
  },
  {
    n: "CLAIM",
    kicker: "Settlement",
    title: "1:1 claim or 50/50 fallback",
    text: "Winning claims redeem 1 USDG each. If no valid report lands within 48h, cancelExpired unlocks 50% per claim.",
  },
];

const OPERATOR_CARDS = [
  {
    index: "TRD",
    kind: "Traders",
    icon: "tokenizacion-de-activos",
    name: eventProfile.id === "ipo" ? "IPO Traders" : "Macro Traders",
    label: eventProfile.copy.traderCard,
  },
  {
    index: "LP",
    kind: "Liquidity",
    icon: "soluciones-blockchain",
    name: "v4 Liquidity Providers",
    label: "Earn 0.30% LP fees across concentrated [0.80×, 1.25×] ETH and 35%–65% probability ranges.",
  },
  {
    index: "GOV",
    kind: "Governors",
    icon: "redes-blockchain",
    name: "$QTL Holders",
    label: eventProfile.id === "ipo" ? "Nominate upcoming events in 24h windows and vote on the next live market." : "Nominate upcoming macro catalysts in 24h windows and vote on the next live timeline.",
  },
];

const TRANSPARENCY_ROWS = [
  {
    n: "FEE",
    kicker: "Fee Split",
    title: "0.30% LP · 0% protocol fee",
    text: "Every swap fee stays 100% with Uniswap v4 liquidity providers at tickSpacing 60. QTimeline extracts zero protocol fee.",
  },
  {
    n: "CAP",
    kicker: "Beta Caps",
    title: "0.10 ETH & 500 USDG limits",
    text: "Open-beta transaction and position caps protect early liquidity calibrated around the ~$173 reference seed model.",
  },
  {
    n: eventProfile.copy.sourceKey,
    kicker: eventProfile.id === "ipo" ? "First Filing" : "First Release",
    title: eventProfile.copy.sourceTitle,
    text: eventProfile.copy.sourceText,
  },
  {
    n: "EXP",
    kicker: "Cancel Safety",
    title: "Permissionless 48h expiry",
    text: eventProfile.copy.expiryText,
  },
];

const TELEMETRY_ITEMS = [
  {
    outlet: "BENCHMARK",
    quote: eventProfile.copy.benchmark,
    action: "Read Rules",
    href: "/rules/",
  },
  {
    outlet: "UNISWAP V4",
    quote: eventProfile.copy.lockQuote,
    action: "Open Market",
    href: "/market/",
  },
  {
    outlet: "POST-QUANTUM",
    quote: eventProfile.copy.attestQuote,
    action: "View Positions",
    href: "/positions/",
  },
  {
    outlet: "GOVERNANCE",
    quote: "$QTL pre-launch community cadence: 24-hour nomination followed by 24-hour market vote.",
    action: "Vote $QTL",
    href: "/vote/",
  },
];

export default function HomePage() {
  const manifestoWords = MANIFESTO_TEXT.split(" ");
  const marqueeItems = Array.from({ length: 14 });

  return (
    <div className="qt-erestyra">
      <div className="scroll-progress" data-scroll-progress aria-hidden="true" />
      <Loader />
      <Scene />
      <SmoothScroll />
      <Cursor />
      <Header />

      {/* 01 · HERO */}
      <section className="hero">
        <div className="wrap hero__inner">
          <p className="eyebrow hero__eyebrow" data-reveal data-delay="0.15">
            <span className="eyebrow__n">RH·4663</span> QTimeline — Robinhood Chain 4663 · {eventProfile.copy.heroEyebrow}
          </p>
          <h1 className="hero__title" aria-label={`${eventProfile.copy.heroA}, ${eventProfile.copy.heroB}`}>
            <span className="hero__line" aria-hidden="true">
              <span data-scramble data-delay="0.3">
                {eventProfile.copy.heroA}
              </span>
            </span>
            <span className="hero__line hero__line--out" aria-hidden="true">
              <span data-scramble data-delay="0.55">
                {eventProfile.copy.heroB}
              </span>
            </span>
          </h1>
          <p className="hero__lead lead" data-reveal data-delay="0.75">
            {eventProfile.copy.heroLead}
          </p>
        </div>
        <div className="hero__scroll mono" aria-hidden="true">
          <span>Scroll</span>
          <i />
        </div>
      </section>

      {/* 02 · MANIFESTO */}
      <section className="section manifesto" id="about">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">THESIS</span>Core thesis
          </p>
          <p className="manifesto__text" data-words aria-label={MANIFESTO_TEXT}>
            {manifestoWords.map((word, idx) => (
              <span key={idx} className="mw" aria-hidden="true">
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* 03 · PINNED HORIZONTAL SCROLL RAIL */}
      <section id="architecture">
        <div className="rail" data-hscroll>
          <div className="rail__track" data-track>
            <div className="rail__intro">
              <p className="eyebrow" data-reveal>
                <span className="eyebrow__n">STACK</span>Architecture
              </p>
              <SplitHeading text="Architecture" className="split display" />
              <p className="lead" data-reveal>
                Five deterministic primitives linking Uniswap v4 hooks, outcome vaults, and
                post-quantum settlement.
              </p>
            </div>

            {ARCHITECTURE_ITEMS.map((item) => (
              <div key={item.slug} className="rail__item">
                <Link href={item.href} className="card" data-cursor>
                  <span className="card__top mono">
                    <span>{item.index}</span>
                    <span>{item.kindLabel}</span>
                  </span>
                  <span className="card__icon">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/icons/${item.icon}.svg`} alt="" width={96} height={96} loading="eager" decoding="async" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="card__icon-on"
                      src={`/icons/${item.icon}-active.svg`}
                      alt=""
                      width={96}
                      height={96}
                      loading="eager"
                      decoding="async"
                    />
                  </span>
                  <span className="card__name">{item.name}</span>
                  <span className="card__label">{item.label}</span>
                  <span className="card__arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 · MARQUEE */}
      <div className="marquee" aria-label={MARQUEE_PHRASE}>
        <div className="marquee__track" aria-hidden="true">
          {marqueeItems.map((_, idx) => (
            <span key={idx}>
              {MARQUEE_PHRASE} <i aria-hidden="true">◆</i>
            </span>
          ))}
        </div>
      </div>

      {/* 05 · COUPLED POOLS */}
      <section className="section products" id="pools" data-dim="0.5">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">POOLS</span>Pools &amp; Vault
          </p>
          <div className="products__head">
            <SplitHeading text="Three v4 Pools" className="split display" />
            <p className="lead" data-reveal>
              Simultaneous ETH and probability discovery across both branches of the fork.
            </p>
          </div>
          <ul className="plist">
            {POOL_MODULES.map((mod) => (
              <li key={mod.index} className="plist__item" data-reveal>
                <Link href={mod.href} className="plist__row" data-cursor>
                  <span className="plist__idx mono">{mod.index}</span>
                  <span className="plist__name">
                    {mod.prefix}
                    <b>{mod.bold}</b>
                  </span>
                  <span className="plist__label">{mod.label}</span>
                  <span aria-hidden="true" />
                  <span className="plist__go" aria-hidden="true">
                    →
                  </span>
                </Link>
                <Link href={mod.href} className="plist__site" data-cursor>
                  <span>{mod.cta}</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 06 · FIGURES */}
      <section className="section figures">
        <div className="wrap figures__grid">
          {FIGURES_ITEMS.map((fig) => (
            <div key={fig.caption} className="fig" data-reveal>
              <p className="fig__v">
                {fig.count !== null ? (
                  <span data-count={String(fig.count)}>{fig.count}</span>
                ) : (
                  <span>{fig.symbol}</span>
                )}
                {fig.unit ? <small>{fig.unit}</small> : null}
              </p>
              <p className="fig__t">{fig.caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 07 · HOW IT WORKS */}
      <section className="section features" id="how-it-works" data-dim="0.5">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">FLOW</span>Execution Lifecycle
          </p>
          <div className="products__head">
            <SplitHeading text="How it works" className="split display-md" />
            <p className="lead" data-reveal>
              Five on-chain phases from USDG collateral split to post-quantum settlement on Robinhood
              Chain.
            </p>
          </div>
          <ul className="flist">
            {LIFECYCLE_ROWS.map((row) => (
              <li key={row.n} className="frow" data-reveal>
                <span className="frow__n mono">{row.n}</span>
                <div>
                  <p className="frow__k mono">{row.kicker}</p>
                  <h3 className="frow__t">{row.title}</h3>
                </div>
                <p className="frow__p">{row.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 08 · OPERATORS */}
      <section className="section" id="operators" data-dim="0.5">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">ROLES</span>Operators
          </p>
          <div className="products__head">
            <SplitHeading text="Built for every participant" className="split display-md" />
            <p className="lead" data-reveal>
              {eventProfile.id === "ipo" ? "Conditional markets for IPO traders" : "Non-custodial conditional infrastructure for macro traders"}, Uniswap v4 LPs, and $QTL
              voters.
            </p>
          </div>
          <div className="related__grid">
            {OPERATOR_CARDS.map((op) => (
              <Link key={op.index} href="/market/" className="card" data-cursor data-reveal>
                <span className="card__top mono">
                  <span>{op.index}</span>
                  <span>{op.kind}</span>
                </span>
                <span className="card__icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/icons/${op.icon}.svg`} alt="" width={96} height={96} loading="eager" decoding="async" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="card__icon-on"
                    src={`/icons/${op.icon}-active.svg`}
                    alt=""
                    width={96}
                    height={96}
                    loading="eager"
                    decoding="async"
                  />
                </span>
                <span className="card__name">{op.name}</span>
                <span className="card__label">{op.label}</span>
                <span className="card__arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 09 · INVERTED CONTRAST SECTION */}
      <section className="section partners inv" id="settlement">
        <div className="wrap partners__grid">
          <article className="partner">
            <p className="eyebrow" data-reveal>
              <span className="eyebrow__n">V4</span>Execution layer
            </p>
            <div className="partner__mark" data-reveal>
              QTIMELINE · 4663
            </div>
            <SplitHeading
              as="h3"
              text="Three Uniswap v4 pools behind one hook"
              className="split display-sm"
            />
            <p className="lead" data-reveal>
              {eventProfile.copy.lockLead}
            </p>
            <Link href="/market/" className="link-arrow" data-reveal data-cursor>
              Enter Conditional Market →
            </Link>
          </article>

          <article className="partner">
            <p className="eyebrow" data-reveal>
              <span className="eyebrow__n">FIPS·204</span>Post-quantum oracle
            </p>
            <div className="partner__mark partner__mark--btc" data-reveal aria-hidden="true">
              ML-DSA-44<sup>®</sup>
            </div>
            <SplitHeading
              as="h3"
              text="Dual ECDSA and FIPS 204 attestation"
              className="split display-sm"
            />
            <p className="lead" data-reveal>
              No single classical key can settle a market. OutcomeVault unlocks only when both an
              ECDSA signature and a NIST FIPS 204 ML-DSA-44 lattice proof verify on-chain.
            </p>
            <Link href="/rules/" className="link-arrow" data-reveal data-cursor>
              Inspect Resolution Rules →
            </Link>
          </article>
        </div>
      </section>

      {/* 10 · TRANSPARENCY */}
      <section className="section features" id="transparency" data-dim="0.5">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">SPEC</span>Guarantees &amp; Disclosures
          </p>
          <div className="products__head">
            <SplitHeading text="What is enforced on-chain" className="split display-md" />
            <p className="lead" data-reveal>
              {eventProfile.copy.enforced}
            </p>
          </div>
          <ul className="flist">
            {TRANSPARENCY_ROWS.map((row) => (
              <li key={row.n} className="frow" data-reveal>
                <span className="frow__n mono">{row.n}</span>
                <div>
                  <p className="frow__k mono">{row.kicker}</p>
                  <h3 className="frow__t">{row.title}</h3>
                </div>
                <p className="frow__p">{row.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 11 · TELEMETRY */}
      <section className="section press" id="telemetry" data-dim="0.6">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">LIVE</span>Protocol Telemetry
          </p>
          <SplitHeading text="Verified specifications..." className="split display-md" />
          <ul className="press__list">
            {TELEMETRY_ITEMS.map((item) => (
              <li key={item.outlet} data-reveal>
                <Link href={item.href} data-cursor>
                  <span className="press__outlet mono">{item.outlet}</span>
                  <q className="press__q">{item.quote}</q>
                  <span className="press__go mono">{item.action} ↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 12 · 3D PORTAL */}
      <section className="section" data-dim="0.5">
        <div className="wrap">
          <Link href="/market/" className="portal__link" data-cursor data-reveal>
            <span className="portal__ring" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="portal__k mono">Conditional Discovery</span>
            <span className="portal__t">
              Enter the universe of <b>QTimeline</b>
            </span>
            <span className="portal__d mono">Open Conditional Market →</span>
          </Link>
        </div>
      </section>

      {/* 13 · INVERTED CTA */}
      <section className="cta" id="genesis">
        <div className="wrap">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__n">LAUNCH</span>{eventProfile.id === "ipo" ? "Live market" : "Genesis Market"}
          </p>
          <SplitHeading text="Ready to trade parallel timelines?" className="split display" />
          <Link href="/market/" className="cta__btn" data-cursor data-reveal>
            <span>Open Conditional Market</span>
            <svg viewBox="0 0 34 12" aria-hidden="true">
              <path d="M0 6h32M27 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="ftr" data-dim="true">
        <div className="ftr__top">
          <Link href="/" className="ftr__logo" aria-label="QTimeline Protocol">
            <img
              src="/brand/qtimeline-logo.png"
              alt=""
              width={88}
              height={88}
              style={{ width: "88px", height: "88px", objectFit: "contain", display: "block" }}
            />
            <span className="ftr__wordmark">QTIMELINE</span>
          </Link>
          <div className="ftr__cols">
            <div>
              <p className="eyebrow">Architecture</p>
              <ul>
                {ARCHITECTURE_ITEMS.map((item) => (
                  <li key={item.slug}>
                    <Link href={item.href}>{item.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow">Pools &amp; Vault</p>
              <ul>
                {POOL_MODULES.map((mod) => (
                  <li key={mod.index}>
                    <a href="#pools">
                      {mod.prefix}
                      {mod.bold}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow">QTimeline</p>
              <ul>
                <li>
                  <a href="#settlement">Robinhood 4663</a>
                </li>
                <li>
                  <a href="#telemetry">Telemetry</a>
                </li>
                <li>
                  <Link href="/rules/">Resolution Rules</Link>
                </li>
                <li>
                  <Link href="/vote/">$QTL Governance</Link>
                </li>
                <li>
                  <a href="https://x.com/QTimelineHook" target="_blank" rel="noopener noreferrer">
                    X (@QTimelineHook) ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="ftr__bottom mono">
          <span>
            © 2026 QTimeline Protocol · Robinhood Chain 4663 · {eventProfile.copy.footer}. All rights
            reserved.
          </span>
          <nav aria-label="Protocol">
            <Link href="/market/">Conditional Market</Link>
            <Link href="/positions/">Positions</Link>
            <Link href="/rules/">ML-DSA-44 Specs</Link>
            <a href="https://x.com/QTimelineHook" target="_blank" rel="noopener noreferrer">
              X ↗
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
