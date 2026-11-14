"use client";
import { useEffect, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import { robinhoodChain } from "@qtimeline/chain";

export function WalletButton() {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const eth = (window as Window & { ethereum?: { on?: (name: string, cb: (...a: unknown[]) => void) => void; removeListener?: (name: string, cb: (...a: unknown[]) => void) => void } }).ethereum;
    const accountsChanged = (items: unknown) => setAddress(Array.isArray(items) && typeof items[0] === "string" ? items[0] as Address : undefined);
    const chainChanged = (id: unknown) => setChainId(typeof id === "string" ? Number(id) : undefined);
    eth?.on?.("accountsChanged", accountsChanged);
    eth?.on?.("chainChanged", chainChanged);
    return () => { eth?.removeListener?.("accountsChanged", accountsChanged); eth?.removeListener?.("chainChanged", chainChanged); };
  }, []);
  async function connect() {
    const eth = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
    if (!eth) { window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer"); return; }
    setBusy(true);
    try {
      const client = createWalletClient({ chain: robinhoodChain, transport: custom(eth) });
      const [account] = await client.requestAddresses();
      setAddress(account);
      const actualChain = await client.getChainId();
      setChainId(actualChain);
      if (actualChain !== robinhoodChain.id) await client.switchChain({ id: robinhoodChain.id });
      setChainId(robinhoodChain.id);
    } finally { setBusy(false); }
  }
  if (address && chainId && chainId !== robinhoodChain.id) return <button className="wallet" onClick={connect} disabled={busy}>Switch to Robinhood</button>;
  if (address) return <button className="wallet" onClick={() => setAddress(undefined)} title="Disconnect this app">{address.slice(0, 6)}…{address.slice(-4)} · Disconnect</button>;
  return <button className="wallet" onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect wallet"}</button>;
}
