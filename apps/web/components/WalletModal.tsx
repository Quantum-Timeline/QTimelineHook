"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { robinhoodChain } from "@qtimeline/chain";
import { useWallet, type DetectedWallet } from "@/lib/wallet";

type Known = { key: string; name: string; logo: string; rdns: string[]; match: RegExp; url: string };

/** Wallets worth listing even when not installed, so a newcomer sees where to get one. */
export const KNOWN_WALLETS: Known[] = [
  { key: "metamask", name: "MetaMask", logo: "/wallets/metamask.svg", rdns: ["io.metamask"], match: /metamask/i, url: "https://metamask.io/download/" },
  { key: "rabby", name: "Rabby", logo: "/wallets/rabby.svg", rdns: ["io.rabby"], match: /rabby/i, url: "https://rabby.io/" },
  { key: "coinbase", name: "Coinbase Wallet", logo: "/wallets/coinbase.svg", rdns: ["com.coinbase.wallet"], match: /coinbase/i, url: "https://www.coinbase.com/wallet/downloads" },
  { key: "okx", name: "OKX Wallet", logo: "/wallets/okx.svg", rdns: ["com.okex.wallet"], match: /okx|okex/i, url: "https://www.okx.com/web3" },
  { key: "phantom", name: "Phantom", logo: "/wallets/phantom.svg", rdns: ["app.phantom"], match: /phantom/i, url: "https://phantom.com/download" },
  { key: "trust", name: "Trust Wallet", logo: "/wallets/trust.png", rdns: ["com.trustwallet.app"], match: /trust/i, url: "https://trustwallet.com/download" },
];

const isKnown = (wallet: DetectedWallet, known: Known) => (wallet.rdns ? known.rdns.includes(wallet.rdns) : false) || known.match.test(wallet.name);

/** Wallet chooser: detected wallets first, then popular ones that still need installing. */
export function WalletModal() {
  const { pickerOpen, closePicker, wallets, connectWith, connectingId, error, clearError } = useWallet();

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !connectingId) closePicker(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [pickerOpen, closePicker, connectingId]);

  if (!pickerOpen || typeof document === "undefined") return null;

  const detectedKnown = KNOWN_WALLETS.flatMap((known) => {
    const wallet = wallets.find((item) => isKnown(item, known));
    return wallet ? [{ known, wallet }] : [];
  });
  const knownIds = new Set(detectedKnown.map((item) => item.wallet.id));
  const otherDetected = wallets.filter((item) => !knownIds.has(item.id));
  const missing = KNOWN_WALLETS.filter((known) => !wallets.some((item) => isKnown(item, known)));

  return createPortal(
    <div className="wmodal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connectingId) closePicker(); }}>
      <div className="wmodal__card" role="dialog" aria-modal="true" aria-labelledby="wmodal-title">
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img
              src="/brand/qtimeline-logo.png"
              alt=""
              width={28}
              height={28}
              style={{ width: "28px", height: "28px", objectFit: "contain", flexShrink: 0 }}
            />
            <div>
              <h2 id="wmodal-title">Connect a wallet</h2>
              <p>Pick the wallet you use. We will switch it to {robinhoodChain.name}.</p>
            </div>
          </div>
          <button className="wmodal__close" onClick={closePicker} disabled={connectingId !== undefined} aria-label="Close">✕</button>
        </header>

        {error && <div className="wmodal__error" role="alert">{error}<button onClick={clearError} aria-label="Dismiss">✕</button></div>}

        {(detectedKnown.length > 0 || otherDetected.length > 0) && <p className="wmodal__group">Detected on this device</p>}
        <ul className="wmodal__list">
          {detectedKnown.map(({ known, wallet }) => (
            <li key={wallet.id}>
              <button onClick={() => void connectWith(wallet.id)} disabled={connectingId !== undefined}>
                <img src={known.logo} alt="" width={40} height={40} />
                <span className="wmodal__name">{known.name}</span>
                <span className="wmodal__tag">{connectingId === wallet.id ? "Check your wallet…" : "Detected"}</span>
              </button>
            </li>
          ))}
          {otherDetected.map((wallet) => (
            <li key={wallet.id}>
              <button onClick={() => void connectWith(wallet.id)} disabled={connectingId !== undefined}>
                {wallet.icon ? <img src={wallet.icon} alt="" width={40} height={40} /> : <span className="wmodal__fallback" aria-hidden="true">{wallet.name.slice(0, 1)}</span>}
                <span className="wmodal__name">{wallet.name}</span>
                <span className="wmodal__tag">{connectingId === wallet.id ? "Check your wallet…" : "Detected"}</span>
              </button>
            </li>
          ))}
        </ul>

        {wallets.length === 0 && (
          <div className="wmodal__empty">
            <b>No wallet detected in this browser.</b>
            <span>Install one below, then reload this page. On a phone, open this site inside your wallet app&rsquo;s browser.</span>
          </div>
        )}

        {missing.length > 0 && <p className="wmodal__group">{wallets.length === 0 ? "Popular wallets" : "More wallets"}</p>}
        <ul className="wmodal__list wmodal__list--more">
          {missing.map((known) => (
            <li key={known.key}>
              <a href={known.url} target="_blank" rel="noreferrer">
                <img src={known.logo} alt="" width={40} height={40} />
                <span className="wmodal__name">{known.name}</span>
                <span className="wmodal__tag wmodal__tag--install">Install ↗</span>
              </a>
            </li>
          ))}
        </ul>
        <footer>New to wallets? A wallet is a browser extension or app that holds your funds and signs transactions. QTimeline never sees your keys.</footer>
      </div>
    </div>,
    document.body,
  );
}
