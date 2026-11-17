"use client";
import { useEffect, useRef, useState } from "react";
import { robinhoodChain } from "@qtimeline/chain";
import { shortAddress, useWallet } from "@/lib/wallet";

export function WalletButton() {
  const { account, connect, connecting, disconnect, wrongChain, switchChain, activeWallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);

  if (!account) {
    return (
      <button className="wallet" onClick={() => void connect()} disabled={connecting}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
          <path d="M16 12h5" />
          <circle cx="17.5" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
        <span>{connecting ? "Check your wallet…" : "Connect wallet"}</span>
      </button>
    );
  }
  if (wrongChain) {
    return <button className="wallet wallet--warn" onClick={() => void switchChain()}>Switch to {robinhoodChain.name}</button>;
  }
  return (
    <div className="wallet-menu" ref={box}>
      <button className="wallet wallet--on" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {activeWallet?.icon && <img src={activeWallet.icon} alt="" width={18} height={18} />}{shortAddress(account)}
      </button>
      {open && (
        <div className="wallet-menu__panel" role="menu">
          <p>{activeWallet ? `${activeWallet.name} · ` : ""}{robinhoodChain.name}</p>
          <button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(account); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "Copied ✓" : "Copy address"}</button>
          <a role="menuitem" href={`${robinhoodChain.blockExplorers.default.url}/address/${account}`} target="_blank" rel="noreferrer">View on explorer ↗</a>
          <button role="menuitem" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
