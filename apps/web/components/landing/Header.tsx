"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export default function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      window.__lenis?.stop();
    } else {
      window.__lenis?.start();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closeMenu = () => setOpen(false);

  return (
    <>
      <header className="hdr">
        <Link href="/" className="hdr__logo" aria-label="QTimeline" onClick={closeMenu} data-cursor>
          <span className="hdr__logo-dot" aria-hidden="true" />
          <span>QTIMELINE</span>
        </Link>

        <nav className="hdr__right" aria-label="Primary">
          <div className="lang" role="group" aria-label="Network">
            <Link href="/rules/" aria-current="true">
              ROBINHOOD
            </Link>
            <span aria-hidden="true">/</span>
            <Link href="/#how-it-works">4663</Link>
          </div>
          <Link href="/market/" className="hdr__app-btn" data-cursor onClick={closeMenu}>
            <span>Open App</span>
            <span aria-hidden="true">↗</span>
          </Link>
          <button
            type="button"
            className={`burger${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-controls="qt-menu"
            onClick={() => setOpen((prev) => !prev)}
            data-cursor
          >
            <span className="burger__label">{open ? "Close" : "Menu"}</span>
            <span className="burger__lines" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </nav>
      </header>

      <div id="qt-menu" className={`menu${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="menu__grid">
          <div className="menu__col">
            <p className="eyebrow">Application</p>
            <ul className="menu__big">
              <li>
                <Link href="/market/" onClick={closeMenu}>
                  Conditional Market ↗
                </Link>
              </li>
              <li>
                <Link href="/positions/" onClick={closeMenu}>
                  Positions
                </Link>
              </li>
              <li>
                <Link href="/vote/" onClick={closeMenu}>
                  $QTL Governance
                </Link>
              </li>
              <li>
                <Link href="/rules/" onClick={closeMenu}>
                  Resolution Rules
                </Link>
              </li>
            </ul>
          </div>

          <div className="menu__col">
            <p className="eyebrow">Architecture</p>
            <ul className="menu__list">
              <li><a href="#architecture" onClick={closeMenu}>01 / Bifurcated Outcome Vault</a></li>
              <li><a href="#pools" onClick={closeMenu}>02 / Three Uniswap v4 Pools</a></li>
              <li><a href="#how-it-works" onClick={closeMenu}>03 / 13:25 UTC Hard Cutoff</a></li>
              <li><a href="#transparency" onClick={closeMenu}>04 / ML-DSA-44 Verification</a></li>
              <li><a href="#telemetry" onClick={closeMenu}>05 / Mainnet Specifications</a></li>
            </ul>
          </div>

          <div className="menu__col">
            <p className="eyebrow">Genesis Event</p>
            <p className="lead" style={{ fontSize: "15px" }}>
              BEA Core PCE · October 2026 (≥ 0.30% MoM). Trading halts automatically at 13:25 UTC,
              5 minutes before the 13:30 UTC release.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
