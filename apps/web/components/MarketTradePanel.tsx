"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, isHex, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { robinhoodChain, registryAbi } from "@qtimeline/chain";
import { useMarketId } from "@/lib/use-market-id";
import { canTradeAt } from "@/lib/market-lifecycle";
import { findBestProbabilitySell } from "@/lib/probability-sell.mjs";
import { AnimatedNumber } from "@/lib/motion";
import { TradeProgress, type TradeStep } from "@/components/TradeProgress";
import { ClaimIcon } from "@/components/TokenLogo";

const factoryAbi = parseAbi([
  "function tokens(bytes32) view returns (address[4])",
  "function poolKeys(bytes32) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)[3])",
]);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)","function allowance(address,address) view returns (uint256)","function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)"]);
const routerAbi = parseAbi(["function tradeAsset((bytes32 marketId,address vault,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address assetIn,address assetOut,address recipient,bool yes,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint160 sqrtPriceLimitX96,uint64 deadline,uint64 nonce,bytes32 expectedConfigHash) r) payable returns (uint128 amountOut)","function closeConditional((bytes32 marketId,address vault,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address assetIn,address assetOut,address recipient,bool yes,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint160 sqrtPriceLimitX96,uint64 deadline,uint64 nonce,bytes32 expectedConfigHash) r) returns (uint128 amountOut)","function nonces(address) view returns (uint64)"]);
const probabilityRouterAbi = parseAbi(["function buyProbability((bytes32 marketId,address vault,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address asset,address recipient,bool yes,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint160 sqrtPriceLimitX96,uint64 deadline,uint64 nonce,bytes32 expectedConfigHash) r) returns (uint128 totalOutcome)","function sellProbability((bytes32 marketId,address vault,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address asset,address recipient,bool yes,bool zeroForOne,uint128 amountIn,uint128 swapAmount,uint128 minAmountOut,uint160 sqrtPriceLimitX96,uint64 deadline,uint64 nonce,bytes32 expectedConfigHash) r) returns (uint128 collateralOut)"]);
const MIN_SQRT = 4295128740n;
const MAX_SQRT = 1461446703485210103287273970341n;
const YES_LABEL = process.env.NEXT_PUBLIC_TEST_YES_LABEL || "YES · PCE ≥ 0.30%";
const NO_LABEL = process.env.NEXT_PUBLIC_TEST_NO_LABEL || "NO · PCE < 0.30%";
const TRADE_STEPS: TradeStep[] = [{ key: "prepare", label: "Prepare" }, { key: "approve", label: "Approve" }, { key: "trade", label: "Trade" }, { key: "confirm", label: "Confirm" }];
type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export function MarketTradePanel() {
  const [direction, setDirection] = useState<"buy"|"sell">("buy");
  const [instrument, setInstrument] = useState<"eth"|"probability">("eth");
  const [outcomeYes, setOutcomeYes] = useState(true);
  const [amount, setAmount] = useState("5");
  const [account, setAccount] = useState<Address>();
  const [quote, setQuote] = useState<bigint>();
  const [inputDecimals, setInputDecimals] = useState(6);
  const [outputDecimals, setOutputDecimals] = useState(18);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tx, setTx] = useState<Hex>();
  const [step, setStep] = useState(-1);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [flash, setFlash] = useState(0);

  const marketId = useMarketId();
  const registry = process.env.NEXT_PUBLIC_REGISTRY as Address | undefined;
  const factory = process.env.NEXT_PUBLIC_FACTORY as Address | undefined;
  const router = process.env.NEXT_PUBLIC_ROUTER as Address | undefined;
  const quoter = process.env.NEXT_PUBLIC_V4_QUOTER as Address | undefined;
  const validConfig = !!marketId && isHex(marketId) && marketId.length === 66 && !/^0x0{64}$/i.test(marketId) && [registry,factory,router,quoter].every(a => !!a && isAddress(a) && a !== "0x0000000000000000000000000000000000000000");
  const client = useMemo(() => createPublicClient({ chain: robinhoodChain, transport: http(process.env.NEXT_PUBLIC_RH_RPC || undefined) }), []);

  const refreshQuote = useCallback(async (preserveMessage = false) => {
    setQuote(undefined);
    if (!validConfig || !marketId || !registry || !factory || !quoter || !router) {
      setMessage("Set the deployment manifest to enable a live quote.");
      return;
    }
    if (!/^(?:\d+)(?:\.\d{1,18})?$/.test(amount)) return;
    try {
      const [market, tokens, keys, block] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] }),
        client.readContract({ address: factory, abi: factoryAbi, functionName: "tokens", args: [marketId] }),
        client.readContract({ address: factory, abi: factoryAbi, functionName: "poolKeys", args: [marketId] }),
        client.getBlock(),
      ]);
      if (!canTradeAt({ status: market.status, activated: market.activated, opensAt: market.opensAt, cutoffAt: market.cutoffAt, chainTimestamp: block.timestamp })) throw new Error("Market is not open for trading.");
      const inputToken = instrument === "eth"
        ? direction === "buy" ? tokens[outcomeYes ? 2 : 3] : tokens[outcomeYes ? 0 : 1]
        : direction === "buy" ? tokens[outcomeYes ? 3 : 2] : tokens[outcomeYes ? 2 : 3];
      const pool = keys[instrument === "eth" ? (outcomeYes ? 0 : 1) : 2] as PoolKey;
      const zeroForOne = pool.currency0.toLowerCase() === inputToken.toLowerCase();
      const outputToken = instrument === "eth"
        ? direction === "buy" ? tokens[outcomeYes ? 0 : 1] : tokens[outcomeYes ? 2 : 3]
        : direction === "buy" ? tokens[outcomeYes ? 2 : 3] : tokens[outcomeYes ? 3 : 2];
      if (pool.currency0.toLowerCase() !== inputToken.toLowerCase() && pool.currency1.toLowerCase() !== inputToken.toLowerCase()) throw new Error("Outcome token is not in the configured pool.");
      const usdDecimals = Number(await client.readContract({ address: market.asset, abi: erc20Abi, functionName: "decimals" }));
      const inDec = direction === "buy" || instrument === "probability" ? usdDecimals : 18;
      const outDec = instrument === "eth" && direction === "buy" ? 18 : usdDecimals;
      const amountIn = parseUnits(amount, inDec);
      if (amountIn <= 0n || amountIn > (1n << 127n) - 1n) throw new Error("Amount is outside the supported range.");
      let amountOut: bigint;
      if (instrument === "probability" && direction === "sell") {
        const plan = await findBestProbabilitySell(amountIn, async (exactAmount) => {
          const [quoted] = await client.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: pool, zeroForOne, exactAmount, hookData: "0x" }], blockNumber: block.number }) as unknown as readonly [bigint, bigint];
          return quoted;
        });
        amountOut = plan.collateralOut;
      } else {
        const quoteResult = await client.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: pool, zeroForOne, exactAmount: amountIn, hookData: "0x" }], blockNumber: block.number }) as unknown as readonly [bigint, bigint];
        amountOut = quoteResult[0];
      }
      if (amountOut === 0n || amountOut > (1n << 128n) - 1n) throw new Error("Pool returned no usable quote.");
      setInputDecimals(inDec); setOutputDecimals(outDec); setQuote(amountOut);
      if (!preserveMessage) setMessage("");
      if (pool.currency0.toLowerCase() !== outputToken.toLowerCase() && pool.currency1.toLowerCase() !== outputToken.toLowerCase()) throw new Error("Expected output token is not in the selected pool.");
    } catch (error) {
      if (!preserveMessage) setMessage(error instanceof Error ? error.message : "Unable to quote this trade.");
    }
  }, [amount, client, direction, factory, instrument, marketId, outcomeYes, quoter, registry, router, validConfig]);

  useEffect(() => { const timer = window.setTimeout(() => { void refreshQuote(); }, 250); return () => window.clearTimeout(timer); }, [refreshQuote]);

  async function trade() {
    if (!marketId || !registry || !factory || !router || !quoter || !account) return;
    setBusy(true); setMessage(""); setTx(undefined); setStep(0); setFailed(false); setDone(false);
    try {
      const wallet = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
      if (!wallet) throw new Error("Install an injected wallet first.");
      const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: custom(wallet) });
      if (await walletClient.getChainId() !== robinhoodChain.id) await walletClient.switchChain({ id: robinhoodChain.id });
      let [market, tokens, keys, nonce, block] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] }),
        client.readContract({ address: factory, abi: factoryAbi, functionName: "tokens", args: [marketId] }),
        client.readContract({ address: factory, abi: factoryAbi, functionName: "poolKeys", args: [marketId] }),
        client.readContract({ address: router, abi: routerAbi, functionName: "nonces", args: [account] }),
        client.getBlock(),
      ]);
      if (!market.activated || !canTradeAt({ status: market.status, activated: market.activated, opensAt: market.opensAt, cutoffAt: market.cutoffAt, chainTimestamp: block.timestamp })) throw new Error("Market closed before submission.");
      if (market.status === 1) {
        const sync = { address: registry, abi: registryAbi, functionName: "syncTime" as const, args: [marketId] as const };
        await client.simulateContract({ account, ...sync });
        const syncHash = await walletClient.writeContract({ account, ...sync });
        const syncReceipt = await client.waitForTransactionReceipt({ hash: syncHash });
        if (syncReceipt.status !== "success") throw new Error("Market time sync failed before trading.");
        [market, nonce, block] = await Promise.all([
          client.readContract({ address: registry, abi: registryAbi, functionName: "market", args: [marketId] }),
          client.readContract({ address: router, abi: routerAbi, functionName: "nonces", args: [account] }),
          client.getBlock(),
        ]);
        if (market.status !== 2 || !canTradeAt({ status: market.status, activated: market.activated, opensAt: market.opensAt, cutoffAt: market.cutoffAt, chainTimestamp: block.timestamp })) throw new Error("Market time sync did not open the trade window.");
      }
      const assetIn = instrument === "eth" && direction === "sell" ? ("0x0000000000000000000000000000000000000000" as Address) : market.asset;
      const assetOut = instrument === "eth" && direction === "buy" ? ("0x0000000000000000000000000000000000000000" as Address) : market.asset;
      const inputToken = instrument === "eth"
        ? direction === "buy" ? tokens[outcomeYes ? 2 : 3] : tokens[outcomeYes ? 0 : 1]
        : direction === "buy" ? tokens[outcomeYes ? 3 : 2] : tokens[outcomeYes ? 2 : 3];
      const pool = keys[instrument === "eth" ? (outcomeYes ? 0 : 1) : 2] as PoolKey;
      const zeroForOne = pool.currency0.toLowerCase() === inputToken.toLowerCase();
      const usdDecimals = Number(await client.readContract({ address: market.asset, abi: erc20Abi, functionName: "decimals" }));
      const amountIn = parseUnits(amount, direction === "buy" || instrument === "probability" ? usdDecimals : 18);
      let sellPlan: Awaited<ReturnType<typeof findBestProbabilitySell>> | undefined;
      let latestQuote: bigint;
      if (instrument === "probability" && direction === "sell") {
        sellPlan = await findBestProbabilitySell(amountIn, async (exactAmount) => {
          const [quoted] = await client.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: pool, zeroForOne, exactAmount, hookData: "0x" }], blockNumber: block.number }) as unknown as readonly [bigint, bigint];
          return quoted;
        });
        latestQuote = sellPlan.collateralOut;
      } else {
        const quoteResult = await client.readContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: pool, zeroForOne, exactAmount: amountIn, hookData: "0x" }], blockNumber: block.number }) as unknown as readonly [bigint, bigint];
        latestQuote = quoteResult[0];
      }
      if (latestQuote <= 0n) throw new Error("Pool returned no fresh quote.");
      const minAmountOut = latestQuote * 9900n / 10000n;
      const allowanceTarget = direction === "buy" ? market.asset : inputToken;
      const allowance = await client.readContract({ address: allowanceTarget, abi: erc20Abi, functionName: "allowance", args: [account, router] });
      setStep(1);
      if (allowance < amountIn) {
        await client.simulateContract({ account, address: allowanceTarget, abi: erc20Abi, functionName: "approve", args: [router, amountIn] });
        const approval = await walletClient.writeContract({ address: allowanceTarget, abi: erc20Abi, functionName: "approve", args: [router, amountIn] });
        await client.waitForTransactionReceipt({ hash: approval });
      }
      setStep(2);
      const tradeRequest = { marketId, vault: market.vault, key: pool, assetIn, assetOut, recipient: account, yes: outcomeYes, zeroForOne, amountIn, minAmountOut, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT : MAX_SQRT - 1n, deadline: block.timestamp + 300n, nonce, expectedConfigHash: market.configHash };
      let hash: Hex;
      if (direction === "buy" && instrument === "eth") {
        await client.simulateContract({ account, address: router, abi: routerAbi, functionName: "tradeAsset", args: [tradeRequest], value: 0n });
        hash = await walletClient.writeContract({ address: router, abi: routerAbi, functionName: "tradeAsset", args: [tradeRequest], value: 0n });
      } else {
        if (direction === "sell" && instrument === "eth") {
          const pairedOutcome = tokens[outcomeYes ? 3 : 2];
          const pairedBalance = await client.readContract({ address: pairedOutcome, abi: erc20Abi, functionName: "balanceOf", args: [account] });
          if (pairedBalance > 0n) {
            const pairAllowance = await client.readContract({ address: pairedOutcome, abi: erc20Abi, functionName: "allowance", args: [account, router] });
            if (pairAllowance < pairedBalance) {
              await client.simulateContract({ account, address: pairedOutcome, abi: erc20Abi, functionName: "approve", args: [router, pairedBalance] });
              const pairApproval = await walletClient.writeContract({ address: pairedOutcome, abi: erc20Abi, functionName: "approve", args: [router, pairedBalance] });
              await client.waitForTransactionReceipt({ hash: pairApproval });
            }
          }
        }
        if (instrument === "probability") {
          const probabilityRequest = direction === "buy"
            ? { marketId, vault: market.vault, key: pool, asset: market.asset, recipient: account, yes: outcomeYes, zeroForOne, amountIn, minAmountOut, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT : MAX_SQRT - 1n, deadline: block.timestamp + 300n, nonce, expectedConfigHash: market.configHash }
            : { marketId, vault: market.vault, key: pool, asset: market.asset, recipient: account, yes: outcomeYes, zeroForOne, amountIn, swapAmount: sellPlan!.swapAmount, minAmountOut, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT : MAX_SQRT - 1n, deadline: block.timestamp + 300n, nonce, expectedConfigHash: market.configHash };
          const functionName = direction === "buy" ? "buyProbability" : "sellProbability";
          await client.simulateContract({ account, address: router, abi: probabilityRouterAbi, functionName, args: [probabilityRequest] } as never);
          hash = await walletClient.writeContract({ account, address: router, abi: probabilityRouterAbi, functionName, args: [probabilityRequest] } as never);
        } else {
          await client.simulateContract({ account, address: router, abi: routerAbi, functionName: "closeConditional", args: [tradeRequest] });
          hash = await walletClient.writeContract({ account, address: router, abi: routerAbi, functionName: "closeConditional", args: [tradeRequest] });
        }
      }
      setTx(hash); setStep(3); setMessage("Transaction sent; waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Trade reverted. Refresh the quote and try again.");
      setDone(true); setFlash((n) => n + 1); setMessage("Trade confirmed."); void refreshQuote(true);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Trade failed."); }
    finally { setBusy(false); }
  }

  async function connectWallet() {
    const wallet = (window as Window & { ethereum?: Parameters<typeof custom>[0] }).ethereum;
    if (!wallet) { setMessage("Install an injected wallet to trade."); return; }
    const c = createWalletClient({ chain: robinhoodChain, transport: custom(wallet) });
    const [address] = await c.requestAddresses(); setAccount(address);
  }

  let shownQuote = quote === undefined ? "—" : formatUnits(quote, outputDecimals);
  if (quote !== undefined && instrument === "probability" && direction === "buy") {
    try { shownQuote = formatUnits(quote + parseUnits(amount, inputDecimals), outputDecimals); } catch { /* Keep the last valid quote formatting while input is incomplete. */ }
  }

  const outputUnit = instrument === "eth" && direction === "buy" ? "ETH conditional" : "USDG conditional";
  const inputUnit = direction === "buy" ? "USDG" : instrument === "eth" ? "ETH claim" : "USDG claim";
  const chips = direction === "sell" && instrument === "eth" ? ["0.0025", "0.005", "0.01"] : ["5", "10", "25", "50"];
  const minReceived = quote === undefined ? undefined : (() => {
    try {
      const gross = instrument === "probability" && direction === "buy" ? quote + parseUnits(amount, inputDecimals) : quote;
      return formatUnits(gross * 9900n / 10000n, outputDecimals);
    } catch { return undefined; }
  })();
  const inputAsset: "ETH" | "USDG" = direction === "buy" || instrument === "probability" ? "USDG" : "ETH";
  const outputAsset: "ETH" | "USDG" = instrument === "eth" && direction === "buy" ? "ETH" : "USDG";
  const showProgress = busy || done || failed;
  const quoteLoading = validConfig && quote === undefined && /^(?:\d+)(?:\.\d{1,18})?$/.test(amount) && !message;

  return (
    <section className="trade-panel" data-outcome={outcomeYes ? "yes" : "no"}>
      <div className="trade-title">
        <div><small>TRADE CONDITIONAL ETH</small><h2>Choose a timeline</h2></div>
        <span className="fee-label">0.30% LP fee</span>
      </div>
      <div className="segmented" style={{ ["--i" as string]: instrument === "eth" ? 0 : 1 }}>
        <button className={instrument === "eth" ? "selected" : ""} onClick={() => setInstrument("eth")}>ETH timeline</button>
        <button className={instrument === "probability" ? "selected" : ""} onClick={() => setInstrument("probability")}>YES / NO odds</button>
      </div>
      <div className="segmented" style={{ ["--i" as string]: direction === "buy" ? 0 : 1 }}>
        <button className={direction === "buy" ? "selected" : ""} onClick={() => setDirection("buy")}>{instrument === "eth" ? "Buy ETH" : "Buy outcome"}</button>
        <button className={direction === "sell" ? "selected" : ""} onClick={() => setDirection("sell")}>{instrument === "eth" ? "Sell ETH" : "Sell outcome"}</button>
      </div>
      <div className="segmented outcome" data-side={outcomeYes ? "yes" : "no"} style={{ ["--i" as string]: outcomeYes ? 0 : 1 }}>
        <button className={outcomeYes ? "selected" : ""} onClick={() => setOutcomeYes(true)}>{YES_LABEL}</button>
        <button className={!outcomeYes ? "selected" : ""} onClick={() => setOutcomeYes(false)}>{NO_LABEL}</button>
      </div>
      <label className="amount-label">{direction === "buy" ? "USDG input" : instrument === "eth" ? "ETH claim input" : "USDG claim input"}
        <div><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="amount-unit"><ClaimIcon asset={inputAsset} yes={outcomeYes} size={26} />{inputUnit}</span></div>
      </label>
      <div className="chips" role="group" aria-label="Quick amounts">
        {chips.map((chip) => <button key={chip} type="button" className={amount === chip ? "is-on" : ""} onClick={() => setAmount(chip)}>{chip}</button>)}
      </div>
      <div className="quote-box" data-loading={quoteLoading}>
        <div className="quote-row"><span>Estimated output</span><strong key={flash}>{quote === undefined ? <span className="shimmer-text">{quoteLoading ? "quoting…" : "—"}</span> : <span className="quote-out"><AnimatedNumber value={shownQuote} /><ClaimIcon asset={outputAsset} yes={instrument === "probability" && direction === "buy" ? outcomeYes : outcomeYes} size={20} />{outputUnit}</span>}</strong></div>
        <div className="quote-row quote-row--sub"><span>Minimum after 1% slippage</span><strong>{minReceived ?? "—"}</strong></div>
      </div>
      <p className="trade-note">{instrument === "eth" ? direction === "buy" ? "The split also returns the opposite claim on your input collateral." : "Selling swaps your existing ETH claim. Matching opposite USDG claims merge to collateral; unpaired output stays conditional." : direction === "buy" ? "Collateral is split, then the opposite side is exchanged in the YES/NO pool." : "Your existing outcome claim is sold; matching opposite claims merge to collateral."} Minimum swap output uses a 1% slippage bound.</p>
      {!account
        ? <button className="primary full" onClick={connectWallet}>Connect wallet to trade</button>
        : <button className="primary full" onClick={trade} disabled={!quote || busy}>{busy ? "Processing…" : direction === "buy" ? `Buy ${outcomeYes ? "YES" : "NO"}` : `Sell ${outcomeYes ? "YES" : "NO"}`}</button>}
      {showProgress && <TradeProgress steps={TRADE_STEPS} current={Math.max(step, 0)} failed={failed} done={done} />}
      <div className="trade-message" data-state={failed ? "error" : done ? "success" : "idle"}>{message}{tx && <> · <a href={`${robinhoodChain.blockExplorers.default.url}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction ↗</a></>}</div>
    </section>
  );
}
