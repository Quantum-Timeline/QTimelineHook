"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { robinhoodChain } from "@qtimeline/chain";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

type WalletState = {
  account?: Address;
  chainId?: number;
  wrongChain: boolean;
  hasProvider: boolean;
  connecting: boolean;
  error?: string;
  connect(): Promise<Address | undefined>;
  switchChain(): Promise<boolean>;
  disconnect(): void;
  clearError(): void;
};

const STORAGE_KEY = "qtimeline.wallet.connected";
const WalletContext = createContext<WalletState | null>(null);

const getProvider = (): Eip1193 | undefined => (typeof window === "undefined" ? undefined : (window as Window & { ethereum?: Eip1193 }).ethereum);
const hexChain = (id: number) => `0x${id.toString(16)}`;

/** One wallet connection shared by the header and every page, so a connection made anywhere is seen everywhere. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [hasProvider, setHasProvider] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const provider = getProvider();
    setHasProvider(!!provider);
    if (!provider) return;
    const onAccounts = (items: unknown) => {
      const next = Array.isArray(items) && typeof items[0] === "string" ? (items[0] as Address) : undefined;
      setAccount(next);
      if (!next) { try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage may be blocked */ } }
    };
    const onChain = (id: unknown) => setChainId(typeof id === "string" ? Number.parseInt(id, 16) : undefined);
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);

    // Restore a previous session silently: eth_accounts never opens a wallet prompt.
    let remembered = false;
    try { remembered = window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* ignore */ }
    if (remembered) {
      provider.request({ method: "eth_accounts" }).then(onAccounts).catch(() => undefined);
    }
    provider.request({ method: "eth_chainId" }).then(onChain).catch(() => undefined);
    return () => { provider.removeListener?.("accountsChanged", onAccounts); provider.removeListener?.("chainChanged", onChain); };
  }, []);

  const switchChain = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return false;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain(robinhoodChain.id) }] });
    } catch (switchError) {
      // 4902: the wallet has never seen this chain. Offer to add it instead of failing.
      if ((switchError as { code?: number }).code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: hexChain(robinhoodChain.id), chainName: robinhoodChain.name, nativeCurrency: robinhoodChain.nativeCurrency,
              rpcUrls: [...robinhoodChain.rpcUrls.default.http], blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
            }],
          });
        } catch { setError("Your wallet did not add Robinhood Chain. Add it manually, then try again."); return false; }
      } else { setError("Could not switch network. Switch to Robinhood Chain in your wallet, then try again."); return false; }
    }
    const id = await provider.request({ method: "eth_chainId" }).catch(() => undefined);
    setChainId(typeof id === "string" ? Number.parseInt(id, 16) : undefined);
    return true;
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    setHasProvider(!!provider);
    if (!provider) {
      setError("No wallet found. Install MetaMask or another browser wallet, or open this page inside your wallet's browser.");
      return undefined;
    }
    setConnecting(true);
    setError(undefined);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? (accounts[0] as Address) : undefined;
      if (!next) { setError("No account was shared. Unlock your wallet and try again."); return undefined; }
      setAccount(next);
      try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
      const id = await provider.request({ method: "eth_chainId" }).catch(() => undefined);
      const current = typeof id === "string" ? Number.parseInt(id, 16) : undefined;
      setChainId(current);
      if (current !== robinhoodChain.id) await switchChain();
      return next;
    } catch (connectError) {
      const code = (connectError as { code?: number }).code;
      setError(code === 4001 ? "Connection was cancelled in your wallet." : "Could not connect your wallet. Try again.");
      return undefined;
    } finally { setConnecting(false); }
  }, [switchChain]);

  const disconnect = useCallback(() => {
    setAccount(undefined);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo<WalletState>(() => ({
    account, chainId, hasProvider, connecting, error,
    wrongChain: !!account && chainId !== undefined && chainId !== robinhoodChain.id,
    connect, switchChain, disconnect, clearError: () => setError(undefined),
  }), [account, chainId, hasProvider, connecting, error, connect, switchChain, disconnect]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside the page Frame");
  return value;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
