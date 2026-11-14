"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { robinhoodChain } from "@qtimeline/chain";
import { WalletModal } from "@/components/WalletModal";

export type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

/** A wallet found in the browser, via EIP-6963 or the legacy window.ethereum. */
export type DetectedWallet = { id: string; name: string; icon?: string; rdns?: string; provider: Eip1193 };

type WalletState = {
  account?: Address;
  chainId?: number;
  wrongChain: boolean;
  hasProvider: boolean;
  connecting: boolean;
  error?: string;
  wallets: DetectedWallet[];
  activeWallet?: DetectedWallet;
  pickerOpen: boolean;
  connectingId?: string;
  /** Opens the wallet picker. Every "Connect wallet" button calls this. */
  connect(): Promise<undefined>;
  connectWith(id: string): Promise<Address | undefined>;
  closePicker(): void;
  switchChain(): Promise<boolean>;
  disconnect(): void;
  clearError(): void;
};

const STORAGE_KEY = "qtimeline.wallet.connected";
const WalletContext = createContext<WalletState | null>(null);
let activeProvider: Eip1193 | undefined;

/** The provider of the wallet the visitor picked; falls back to the single injected wallet. */
export function getActiveProvider(): Eip1193 | undefined {
  if (activeProvider) return activeProvider;
  return typeof window === "undefined" ? undefined : (window as Window & { ethereum?: Eip1193 }).ethereum;
}

const hexChain = (id: number) => `0x${id.toString(16)}`;
const parseChain = (value: unknown) => (typeof value === "string" ? Number.parseInt(value, 16) : undefined);

/** One wallet connection shared by the header and every page, so a connection made anywhere is seen everywhere. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string>();
  const [error, setError] = useState<string>();
  const detach = useRef<() => void>(() => undefined);

  // Discover wallets: EIP-6963 announcements first, then the legacy injected object if nothing announced itself.
  useEffect(() => {
    const found = new Map<string, DetectedWallet>();
    const publish = () => setWallets([...found.values()]);
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 }>).detail;
      if (!detail?.info || !detail.provider) return;
      found.set(detail.info.rdns || detail.info.uuid, { id: detail.info.rdns || detail.info.uuid, name: detail.info.name, icon: detail.info.icon, rdns: detail.info.rdns, provider: detail.provider });
      publish();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = window.setTimeout(() => {
      const injected = (window as Window & { ethereum?: Eip1193 & { providers?: Eip1193[] } }).ethereum;
      if (found.size === 0 && injected) { found.set("injected", { id: "injected", name: "Browser wallet", provider: injected }); publish(); }
    }, 500);
    return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); window.clearTimeout(legacy); };
  }, []);

  const attach = useCallback((wallet: DetectedWallet) => {
    detach.current();
    activeProvider = wallet.provider;
    const onAccounts = (items: unknown) => {
      const next = Array.isArray(items) && typeof items[0] === "string" ? (items[0] as Address) : undefined;
      setAccount(next);
      if (!next) { try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage may be blocked */ } }
    };
    const onChain = (id: unknown) => setChainId(parseChain(id));
    wallet.provider.on?.("accountsChanged", onAccounts);
    wallet.provider.on?.("chainChanged", onChain);
    detach.current = () => { wallet.provider.removeListener?.("accountsChanged", onAccounts); wallet.provider.removeListener?.("chainChanged", onChain); };
    setActiveId(wallet.id);
  }, []);

  // Restore the previous session silently once the remembered wallet announces itself. eth_accounts never prompts.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || wallets.length === 0) return;
    let remembered: string | null = null;
    try { remembered = window.localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
    if (!remembered) return;
    const wallet = wallets.find((item) => item.id === remembered) ?? (remembered === "1" ? wallets[0] : undefined);
    if (!wallet) return;
    restored.current = true;
    attach(wallet);
    wallet.provider.request({ method: "eth_accounts" }).then((items) => {
      if (Array.isArray(items) && typeof items[0] === "string") setAccount(items[0] as Address);
    }).catch(() => undefined);
    wallet.provider.request({ method: "eth_chainId" }).then((id) => setChainId(parseChain(id))).catch(() => undefined);
  }, [wallets, attach]);

  useEffect(() => () => detach.current(), []);

  const switchChain = useCallback(async () => {
    const provider = getActiveProvider();
    if (!provider) return false;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain(robinhoodChain.id) }] });
    } catch (switchError) {
      // 4902: the wallet has never seen this chain. Add it instead of failing.
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
    setChainId(parseChain(id));
    return true;
  }, []);

  const connectWith = useCallback(async (id: string) => {
    const wallet = wallets.find((item) => item.id === id);
    if (!wallet) { setError("That wallet is not available in this browser."); return undefined; }
    setConnectingId(id);
    setError(undefined);
    try {
      attach(wallet);
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? (accounts[0] as Address) : undefined;
      if (!next) { setError("No account was shared. Unlock your wallet and try again."); return undefined; }
      setAccount(next);
      try { window.localStorage.setItem(STORAGE_KEY, wallet.id); } catch { /* ignore */ }
      setPickerOpen(false);
      const current = parseChain(await wallet.provider.request({ method: "eth_chainId" }).catch(() => undefined));
      setChainId(current);
      if (current !== robinhoodChain.id) await switchChain();
      return next;
    } catch (connectError) {
      const code = (connectError as { code?: number }).code;
      setError(code === 4001 ? "Connection was cancelled in your wallet." : "Could not connect your wallet. Try again.");
      return undefined;
    } finally { setConnectingId(undefined); }
  }, [attach, switchChain, wallets]);

  const connect = useCallback(async () => {
    setError(undefined);
    // A single detected wallet does not need a chooser unless the visitor wants another; the picker always opens so the choice is visible.
    setPickerOpen(true);
    return undefined;
  }, []);

  const disconnect = useCallback(() => {
    setAccount(undefined);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo<WalletState>(() => ({
    account, chainId, wallets, pickerOpen, connectingId, error,
    hasProvider: wallets.length > 0,
    connecting: connectingId !== undefined,
    activeWallet: wallets.find((item) => item.id === activeId),
    wrongChain: !!account && chainId !== undefined && chainId !== robinhoodChain.id,
    connect, connectWith, switchChain, disconnect,
    closePicker: () => setPickerOpen(false), clearError: () => setError(undefined),
  }), [account, chainId, wallets, pickerOpen, connectingId, error, activeId, connect, connectWith, switchChain, disconnect]);

  return <WalletContext.Provider value={value}>{children}<WalletModal /></WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside the page Frame");
  return value;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
