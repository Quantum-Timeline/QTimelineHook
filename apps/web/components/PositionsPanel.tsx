"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, isHex, parseAbi, type Address, type Hex } from "viem";
import { robinhoodChain, registryAbi } from "@qtimeline/chain";
import { useMarketId } from "@/lib/use-market-id";

const factoryAbi = parseAbi(["function tokens(bytes32) view returns (address[4])"]);
const vaultAbi = parseAbi(["function outcomeToken(address,bool) view returns (address)","function merge(address,uint256,address)","function redeem(address,bool,uint256,address)"]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)","function decimals() view returns (uint8)"]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
type Claim = { asset: Address; label: string; yes: boolean; address: Address; balance: bigint; decimals: number };
const statusNames = ["Draft","Scheduled","Open","Awaiting result","Final YES","Final NO","Cancelled","Discarded"];

export function PositionsPanel() {
  const [account, setAccount] = useState<Address>();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [status, setStatus] = useState<number>();
  const [message, setMessage] = useState("Connect a wallet to read on-chain claims.");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex>();
  const registry = process.env.NEXT_PUBLIC_REGISTRY as Address | undefined;
  const factory = process.env.NEXT_PUBLIC_FACTORY as Address | undefined;
  const marketId = useMarketId();
  const configured = !!registry && isAddress(registry) && registry !== ZERO && !!factory && isAddress(factory) && factory !== ZERO && !!marketId && isHex(marketId) && marketId.length === 66 && !/^0x0{64}$/i.test(marketId);
  const client = useMemo(() => createPublicClient({ chain: robinhoodChain, transport: http(process.env.NEXT_PUBLIC_RH_RPC || undefined) }), []);

  const refresh = useCallback(async () => {
    if (!configured || !registry || !factory || !marketId || !account) return;
    try {
      const [market, tokens] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] }),
        client.readContract({ address: factory, abi: factoryAbi, functionName: "tokens", args: [marketId] }),
      ]);
      if (!market.vault) throw new Error("Market ID is not registered on Robinhood Chain.");
      const vault = market.vault;
      const assetRows = [
        { asset: ZERO, label: "ETH", yesToken: tokens[0], noToken: tokens[1], decimals: 18 },
        { asset: market.asset, label: "USDG", yesToken: tokens[2], noToken: tokens[3], decimals: Number(await client.readContract({ address: market.asset, abi: tokenAbi, functionName: "decimals" })) },
      ];
      const next: Claim[] = [];
      for (const row of assetRows) {
        const [yesAddress, noAddress] = await Promise.all([
          client.readContract({ address: vault, abi: vaultAbi, functionName: "outcomeToken", args: [row.asset, true] }),
          client.readContract({ address: vault, abi: vaultAbi, functionName: "outcomeToken", args: [row.asset, false] }),
        ]);
        const [yesBalance, noBalance] = await Promise.all([
          client.readContract({ address: yesAddress, abi: tokenAbi, functionName: "balanceOf", args: [account] }),
          client.readContract({ address: noAddress, abi: tokenAbi, functionName: "balanceOf", args: [account] }),
        ]);
        next.push({ asset: row.asset, label: row.label, yes: true, address: yesAddress, balance: yesBalance, decimals: row.decimals }, { asset: row.asset, label: row.label, yes: false, address: noAddress, balance: noBalance, decimals: row.decimals });
      }
      setClaims(next); setStatus(market.status); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read positions from chain."); }
  }, [account, client, configured, factory, marketId, registry]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    const provider = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
    if (!provider) { setMessage("Install an injected wallet to view and manage claims."); return; }
    const wallet = createWalletClient({ chain: robinhoodChain, transport: custom(provider) });
    const [address] = await wallet.requestAddresses(); setAccount(address);
  }

  async function act(kind: "merge" | "redeem", asset: Address, yes?: boolean) {
    if (!account || !registry || !marketId) return;
    setBusy(true); setMessage(""); setTx(undefined);
    try {
      const provider = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
      if (!provider) throw new Error("Wallet provider disconnected.");
      const wallet = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
      if (await wallet.getChainId() !== robinhoodChain.id) await wallet.switchChain({ id: robinhoodChain.id });
      const market = await client.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] });
      const match = claims.filter(x => x.asset === asset);
      const yesClaim = match.find(x => x.yes)!; const noClaim = match.find(x => !x.yes)!;
      const amount = kind === "merge" ? (yesClaim.balance < noClaim.balance ? yesClaim.balance : noClaim.balance) : match.find(x => x.yes === yes)?.balance ?? 0n;
      if (!amount) throw new Error("There is no eligible claim balance for this action.");
      if (kind === "merge" && [4,5,6].includes(market.status)) throw new Error("Resolved claims must be redeemed individually.");
      if (kind === "redeem" && ![4,5,6].includes(market.status)) throw new Error("Claims can only be redeemed after the market resolves.");
      const functionName = kind === "merge" ? "merge" : "redeem";
      const args = kind === "merge" ? [asset, amount, account] as const : [asset, !!yes, amount, account] as const;
      await client.simulateContract({ account, address: market.vault, abi: vaultAbi, functionName, args } as never);
      const hash = await wallet.writeContract({ account, address: market.vault, abi: vaultAbi, functionName, args } as never);
      setTx(hash); setMessage("Transaction sent; waiting for confirmation.");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      setMessage(kind === "merge" ? "Claims merged into collateral." : "Claim redeemed."); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transaction failed."); }
    finally { setBusy(false); }
  }

  return <section className="chain-panel"><div className="panel-head"><div><small>ON-CHAIN CLAIMS</small><h2>{status === undefined ? "Your conditional balances" : `Market · ${statusNames[status] ?? "Unknown"}`}</h2></div><button className="action-button" onClick={account ? () => void refresh() : () => void connect()}>{account ? "Refresh balances" : "Connect wallet"}</button></div>
    {!configured ? <div className="callout">No contract manifest is configured yet. Balances will appear here after the verified market addresses are published.</div> : !account ? <div className="callout">{message}</div> : <>
      <div className="claim-grid">{claims.map(claim => <article className="claim-card" key={`${claim.label}-${claim.yes ? "yes" : "no"}`}><div><span>{claim.label} · {claim.yes ? "YES" : "NO"}</span><b>{claim.yes ? "↗" : "↘"}</b></div><strong>{formatUnits(claim.balance, claim.decimals)}</strong><small>conditional claim</small></article>)}</div>
      <div className="position-actions"><div><strong>Before resolution</strong><span>Merge matching YES + NO claims back into ETH or USDG.</span></div><div className="action-group">{[ZERO, claims.find(x => x.label === "USDG")?.asset].filter((x): x is Address => !!x).map(asset => <button className="action-button" key={asset} disabled={busy || !claims.some(x => x.asset === asset && x.balance > 0n)} onClick={() => void act("merge", asset)}>Merge {asset === ZERO ? "ETH" : "USDG"}</button>)}</div></div>
      {status !== undefined && [4,5,6].includes(status) && <div className="position-actions"><div><strong>Redeem resolved claims</strong><span>Winning claims pay 1:1; cancelled claims pay half of face value.</span></div><div className="action-group">{claims.filter(x => x.balance > 0n).map(claim => <button className="action-button" key={claim.address} disabled={busy} onClick={() => void act("redeem", claim.asset, claim.yes)}>Redeem {claim.label} {claim.yes ? "YES" : "NO"}</button>)}</div></div>}
    </>}
    <p className="panel-message">{message}{tx && <> · <a href={`${robinhoodChain.blockExplorers.default.url}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction ↗</a></>}</p>
  </section>;
}
