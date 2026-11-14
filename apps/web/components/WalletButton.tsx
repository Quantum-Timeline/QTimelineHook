"use client";
import { useEffect, useRef, useState } from "react";
import { robinhoodChain } from "@qtimeline/chain";
import { shortAddress, useWallet } from "@/lib/wallet";

export function WalletButton() {
  const { account, connect, connecting, disconnect, wrongChain, switchChain } = useWallet();
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
    return <button className="wallet" onClick={() => void connect()} disabled={connecting}>{connecting ? "Check your wallet…" : "Connect wallet"}</button>;
  }
  if (wrongChain) {
    return <button className="wallet wallet--warn" onClick={() => void switchChain()}>Switch to {robinhoodChain.name}</button>;
  }
  return (
    <div className="wallet-menu" ref={box}>
      <button className="wallet wallet--on" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <i aria-hidden="true" />{shortAddress(account)}
      </button>
      {open && (
        <div className="wallet-menu__panel" role="menu">
          <p>Connected to {robinhoodChain.name}</p>
          <button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(account); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? "Copied ✓" : "Copy address"}</button>
          <a role="menuitem" href={`${robinhoodChain.blockExplorers.default.url}/address/${account}`} target="_blank" rel="noreferrer">View on explorer ↗</a>
          <button role="menuitem" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
