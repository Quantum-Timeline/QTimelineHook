"use client";

import React, { useEffect, useState } from "react";
import { eventProfile } from "@/lib/event-profile";
import Link from "next/link";

export default function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const shell = document.querySelector(".qt-erestyra");
    shell?.classList.toggle("menu-open", open);
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      window.__lenis?.stop();
    } else {
      window.__lenis?.start();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      shell?.classList.remove("menu-open");
      document.body.style.overflow = "";
    };
  }, [open]);

  const closeMenu = () => setOpen(false);

  const navigateSection = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    setOpen(false);
    document.body.style.overflow = "";
    window.setTimeout(() => {
      window.__lenis?.start();
      if (window.__lenis) {
        window.__lenis.scrollTo(targetId, { force: true, duration: 1.0 });
      } else {
        document.querySelector(targetId)?.scrollIntoView({ behavior: "smooth" });
      }
    }, 60);
  };

  return (
    <>
      <header className="hdr">
        <Link href="/" className="hdr__logo" aria-label="QTimeline" onClick={closeMenu} data-cursor>
          <img
            src="/brand/qtimeline-logo.png"
            alt=""
            width={24}
            height={24}
            style={{ width: "24px", height: "24px", objectFit: "contain", flexShrink: 0 }}
          />
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
          <div className="hdr__actions">
            <a
              href="https://x.com/QTimelineHook"
              target="_blank"
              rel="noopener noreferrer"
              className="hdr__x"
              aria-label="QTimeline on X"
              data-cursor
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <Link href="/market/" className="hdr__app-btn" data-cursor onClick={closeMenu}>
              <span>Open App</span>
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
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

      <div
        id="qt-menu"
        className={`menu${open ? " is-open" : ""}`}
        aria-hidden={!open}
        data-lenis-prevent
        data-lenis-prevent-wheel
        data-lenis-prevent-touch
      >
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
              <li>
                <a href="#architecture" onClick={(e) => navigateSection(e, "#architecture")}>
                  <span>VAULT</span>
                  <span>Bifurcated Outcome Vault</span>
                </a>
              </li>
              <li>
                <a href="#pools" onClick={(e) => navigateSection(e, "#pools")}>
                  <span>POOLS</span>
                  <span>Three Uniswap v4 Pools</span>
                </a>
              </li>
              <li>
                <a href="#how-it-works" onClick={(e) => navigateSection(e, "#how-it-works")}>
                  <span>HOOK</span>
                  <span>{eventProfile.copy.menuLock}</span>
                </a>
              </li>
              <li>
                <a href="#transparency" onClick={(e) => navigateSection(e, "#transparency")}>
                  <span>ORACLE</span>
                  <span>ML-DSA-44 Verification</span>
                </a>
              </li>
              <li>
                <a href="#telemetry" onClick={(e) => navigateSection(e, "#telemetry")}>
                  <span>SPECS</span>
                  <span>Mainnet Specifications</span>
                </a>
              </li>
            </ul>

            <div className="menu__genesis">
              <p className="eyebrow">{eventProfile.id === "ipo" ? "Current event" : "Genesis Event"}</p>
              <p className="menu__genesis-copy">
                {eventProfile.copy.genesis}
              </p>
            </div>
          </div>
        </div>

        <div className="menu__foot">
          <span>Robinhood Chain · 4663</span>
          <a href="https://x.com/QTimelineHook" target="_blank" rel="noopener noreferrer">
            X (@QTimelineHook) ↗
          </a>
          <span>ML-DSA-44 Verified</span>
        </div>
      </div>
    </>
  );
}
