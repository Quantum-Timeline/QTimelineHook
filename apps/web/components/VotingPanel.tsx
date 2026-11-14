"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { robinhoodChain } from "@qtimeline/chain";
import { AnimatedNumber, formatCountdown } from "@/lib/motion";
import { useWallet } from "@/lib/wallet";
import { friendlyError } from "@/lib/errors";

const votingAbi = parseAbi([
  "function tokenBound() view returns (bool)","function qtl() view returns (address)","function nextElectionId() view returns (uint256)",
  "function elections(uint256) view returns (bytes32 candidateA,bytes32 candidateB,uint64 depositStart,uint64 voteStart,uint64 voteEnd,uint64 withdrawAfter,uint256 totalEscrow,uint256 votesA,uint256 votesB,uint8 winner,bool finalized)",
  "function escrowed(uint256,address) view returns (uint256)","function hasVoted(uint256,address) view returns (bool)",
  "function deposit(uint256,uint256)","function withdraw(uint256)","function vote(uint256,uint8)","function finalizeElection(uint256)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)","function allowance(address,address) view returns (uint256)","function approve(address,uint256) returns (bool)"]);
type Election = { candidateA: Hex; candidateB: Hex; depositStart: bigint; voteStart: bigint; voteEnd: bigint; withdrawAfter: bigint; totalEscrow: bigint; votesA: bigint; votesB: bigint; winner: number; finalized: boolean };
const fmt = (time: bigint) => new Date(Number(time) * 1000).toLocaleString();

export function VotingPanel() {
  const { account, connect: connectWallet } = useWallet();
  const [election, setElection] = useState<Election>();
  const [electionId, setElectionId] = useState<bigint>();
  const [balance, setBalance] = useState(0n);
  const [decimals, setDecimals] = useState(18);
  const [amount, setAmount] = useState("100");
  const [voted, setVoted] = useState(false);
  const [tokenBound, setTokenBound] = useState(false);
  const [message, setMessage] = useState("No voting deployment configured.");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(BigInt(Math.floor(Date.now() / 1000)));
  const [tx, setTx] = useState<Hex>();
  const voting = process.env.NEXT_PUBLIC_VOTING as Address | undefined;
  const labelA = process.env.NEXT_PUBLIC_VOTE_CANDIDATE_A_LABEL || "Candidate A";
  const labelB = process.env.NEXT_PUBLIC_VOTE_CANDIDATE_B_LABEL || "Candidate B";
  const idA = process.env.NEXT_PUBLIC_VOTE_CANDIDATE_A_ID?.toLowerCase();
  const idB = process.env.NEXT_PUBLIC_VOTE_CANDIDATE_B_ID?.toLowerCase();
  const configured = !!voting && isAddress(voting) && voting !== "0x0000000000000000000000000000000000000000";
  const client = useMemo(() => createPublicClient({ chain: robinhoodChain, transport: http(process.env.NEXT_PUBLIC_RH_RPC || undefined) }), []);

  const refresh = useCallback(async () => {
    if (!configured || !voting) return;
    try {
      const [bound, next] = await Promise.all([
        client.readContract({ address: voting, abi: votingAbi, functionName: "tokenBound" }),
        client.readContract({ address: voting, abi: votingAbi, functionName: "nextElectionId" }),
      ]);
      setTokenBound(bound);
      if (!bound || next === 0n) { setElection(undefined); setMessage(bound ? "No election has been configured." : "QTL has not been bound to the voting contract."); return; }
      const requested = process.env.NEXT_PUBLIC_ELECTION_ID ? BigInt(process.env.NEXT_PUBLIC_ELECTION_ID) : next - 1n;
      if (requested >= next) throw new Error("Configured election ID does not exist.");
      const [row, token] = await Promise.all([
        client.readContract({ address: voting, abi: votingAbi, functionName: "elections", args: [requested] }),
        client.readContract({ address: voting, abi: votingAbi, functionName: "qtl" }),
      ]);
      const d = Number(await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
      setElectionId(requested); setElection({ candidateA: row[0], candidateB: row[1], depositStart: row[2], voteStart: row[3], voteEnd: row[4], withdrawAfter: row[5], totalEscrow: row[6], votesA: row[7], votesB: row[8], winner: row[9], finalized: row[10] }); setDecimals(d);
      if (account) {
        const [locked, didVote] = await Promise.all([
          client.readContract({ address: voting, abi: votingAbi, functionName: "escrowed", args: [requested, account] }),
          client.readContract({ address: voting, abi: votingAbi, functionName: "hasVoted", args: [requested, account] }),
        ]);
        setBalance(locked); setVoted(didVote);
      } else { setBalance(0n); setVoted(false); }
      const block = await client.getBlock(); setNow(block.timestamp); setMessage("");
    } catch (error) { setMessage(friendlyError(error, "Could not read election from chain.")); }
  }, [account, client, configured, voting]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(action: "deposit" | "withdraw" | "voteA" | "voteB" | "finalize") {
    if (!account || !voting || electionId === undefined || !election) return;
    setBusy(true); setMessage(""); setTx(undefined);
    try {
      const provider = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
      if (!provider) throw new Error("Wallet provider disconnected.");
      const wallet = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
      if (await wallet.getChainId() !== robinhoodChain.id) await wallet.switchChain({ id: robinhoodChain.id });
      let hash: Hex;
      if (action === "deposit") {
        const token = await client.readContract({ address: voting, abi: votingAbi, functionName: "qtl" });
        if (!/^\d+(\.\d*)?$/.test(amount)) throw new Error("Enter a positive QTL amount.");
        const value = parseUnits(amount, decimals);
        if (value <= 0n) throw new Error("Enter a positive QTL amount.");
        const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, voting] });
        if (allowance < value) {
          await client.simulateContract({ account, address: token, abi: erc20Abi, functionName: "approve", args: [voting, value] });
          const approval = await wallet.writeContract({ account, address: token, abi: erc20Abi, functionName: "approve", args: [voting, value] });
          await client.waitForTransactionReceipt({ hash: approval });
        }
        await client.simulateContract({ account, address: voting, abi: votingAbi, functionName: "deposit", args: [electionId, value] });
        hash = await wallet.writeContract({ account, address: voting, abi: votingAbi, functionName: "deposit", args: [electionId, value] });
      } else {
        const functionName = action === "withdraw" ? "withdraw" : action === "finalize" ? "finalizeElection" : "vote";
        const args = action === "voteA" ? [electionId, 0] as const : action === "voteB" ? [electionId, 1] as const : [electionId] as const;
        await client.simulateContract({ account, address: voting, abi: votingAbi, functionName, args } as never);
        hash = await wallet.writeContract({ account, address: voting, abi: votingAbi, functionName, args } as never);
      }
      setTx(hash); setMessage("Transaction sent; waiting for confirmation.");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      setMessage("Transaction confirmed."); await refresh();
    } catch (error) { setMessage(friendlyError(error, "Voting transaction failed.")); }
    finally { setBusy(false); }
  }

  if (!configured) return <section className="chain-panel"><div className="callout">Voting contract address is not configured yet. After deployment, this page reads the election, escrow and votes from Robinhood Chain.</div><p className="panel-message">{message}</p></section>;
  const canDeposit = !!election && now >= election.depositStart && now < election.voteStart;
  const canVote = !!election && now >= election.voteStart && now < election.voteEnd && balance > 0n && !voted;
  const canWithdraw = !!election && (now < election.voteStart || now >= election.voteEnd) && balance > 0n;
  const canFinalize = !!election && !election.finalized && now >= election.voteEnd;
  return <section className="chain-panel"><div className="panel-head"><div><small>QTL escrow voting · Robinhood Chain</small><h2>{election ? `Election #${electionId}` : "Next market"}</h2></div><button className="action-button" onClick={account ? () => void refresh() : () => void connectWallet()}>{account ? "Refresh election" : "Connect wallet"}</button></div>
    {election && <>{(() => {
        const total = election.votesA + election.votesB;
        const shareA = total === 0n ? 50 : Number((election.votesA * 10000n) / total) / 100;
        const phase = election.finalized ? "Finalized" : now < election.depositStart ? "Not started" : now < election.voteStart ? "Deposits open" : now < election.voteEnd ? "Voting live" : "Awaiting finalize";
        const nextAt = election.finalized ? undefined : now < election.depositStart ? election.depositStart : now < election.voteStart ? election.voteStart : now < election.voteEnd ? election.voteEnd : undefined;
        return <div className="tally" data-phase={phase.toLowerCase().replace(/\s+/g, "-")}>
          <div className="tally__head"><span className="tally__phase"><i />{phase}</span>{nextAt !== undefined && <span className="tally__clock">{formatCountdown(nextAt - now)}</span>}</div>
          <div className="tally__bar" role="img" aria-label={`Candidate A ${shareA.toFixed(1)} percent of votes`}><div className="tally__a" style={{ width: `${shareA}%` }} /><div className="tally__b" /></div>
          <div className="tally__legend"><span>A · <AnimatedNumber value={shareA.toFixed(1)} />%</span><span>{total === 0n ? "no votes yet" : "share of escrowed weight"}</span><span>B · <AnimatedNumber value={(100 - shareA).toFixed(1)} />%</span></div>
        </div>;
      })()}<div className="candidate-grid"><article className="candidate-card candidate-card--a"><small>Candidate A</small><h3>{idA === election.candidateA.toLowerCase() ? labelA : election.candidateA}</h3><strong><AnimatedNumber value={formatUnits(election.votesA, decimals)} /> QTL</strong><button className="action-button" disabled={busy || !canVote} onClick={() => void send("voteA")}>Vote A</button></article><article className="candidate-card candidate-card--b"><small>Candidate B · default on a tie</small><h3>{idB === election.candidateB.toLowerCase() ? labelB : election.candidateB}</h3><strong><AnimatedNumber value={formatUnits(election.votesB, decimals)} /> QTL</strong><button className="action-button" disabled={busy || !canVote} onClick={() => void send("voteB")}>Vote B</button></article></div>
      <div className="detail-row"><span>DEPOSITS OPEN</span><strong>{fmt(election.depositStart)} – {fmt(election.voteStart)}</strong></div><div className="detail-row"><span>VOTING WINDOW</span><strong>{fmt(election.voteStart)} – {fmt(election.voteEnd)}</strong></div><div className="detail-row"><span>YOUR ESCROW</span><strong>{account ? `${formatUnits(balance, decimals)} QTL${voted ? " · voted" : ""}` : "Connect wallet to see escrow"}</strong></div>
      {canDeposit && account && <div className="inline-action"><input aria-label="QTL amount to escrow" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/><button className="action-button" disabled={busy} onClick={() => void send("deposit")}>Approve & deposit QTL</button></div>}
      {canWithdraw && <div className="inline-action"><span>Escrow can be withdrawn in the current phase.</span><button className="action-button" disabled={busy} onClick={() => void send("withdraw")}>Withdraw QTL</button></div>}
      {canFinalize && <div className="inline-action"><span>Anyone can finalize this election now.</span><button className="action-button" disabled={busy} onClick={() => void send("finalize")}>Finalize election</button></div>}
      {election.finalized && <div className="callout">Election finalized. Winner: {election.winner === 0 ? labelA : labelB}. Escrow may be withdrawn.</div>}
    </>}
    <p className="panel-message">{message}{tx && <> · <a href={`${robinhoodChain.blockExplorers.default.url}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction ↗</a></>}</p>
  </section>;
}
