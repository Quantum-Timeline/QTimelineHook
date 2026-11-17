# QTimeline — Project Report & Architecture Overview

**Conditional Markets on Uniswap v4 for Robinhood Chain (EVM Mainnet 4663)**

- **Web Application:** https://www.qtimeline.tech (apex `qtimeline.tech` → 308 redirect)
- **Market Terminal:** https://www.qtimeline.tech/market/
- **Positions (claims, merge, redeem):** https://www.qtimeline.tech/positions/
- **Rules & Risks:** https://www.qtimeline.tech/rules/
- **GitHub Repository:** https://github.com/Quantum-Timeline/QTimelineHook (branch `main`)
- **Mainnet Manifest:** `deployments/robinhood-mainnet-ipo.json`

---

## 1. Project Description

**QTimeline** is a conditional-market application built natively on **Uniswap v4** for **Robinhood Chain Mainnet (EVM chain 4663)**. It turns one yes-or-no question about the real world into three tradable pools, and settles the question onchain from a public document.

The live market asks:

> **Will Anthropic's final IPO price be at or above $74.00 per share?**

It resolves from the first Form 424B4 that Anthropic, PBC files on SEC EDGAR (CIK 0002130357). The mechanics:

1. **Claims instead of bets.** A vault splits one USDG (or one ETH) into a YES claim and a NO claim. After the result, the winning claim redeems 1 : 1 and the losing claim redeems for zero. Matching pairs can merge back into collateral before the result.
2. **Three Uniswap v4 pools per market.**
   - **ETH-YES:** the price of ETH in the world where the threshold is met.
   - **ETH-NO:** the price of ETH in the world where it is not.
   - **YES / NO:** the market's implied odds.
   Each pool has a 0.30% LP fee and no protocol fee.
3. **A hook that closes the window.** A per-market hook rejects swaps before `opensAt` and from `cutoffAt` onward, including swaps sent straight to the PoolManager.
4. **Dual-signature resolution.** A bot reads the filing, converts the price to cents, hashes the evidence, and signs the report with ECDSA and with ML-DSA-44 (NIST FIPS 204). `IpoResolutionAdapter` finalizes the market only when both signatures verify onchain.
5. **Cancellation as a safety net.** If no valid report arrives before the deadline, anyone can cancel and every claim redeems for 50 cents.

Two systems live in the repository. The **Anthropic IPO system** (`contracts/src/ipo/`) is deployed on mainnet and is what this report describes. The **Core PCE system** (monthly BEA Core PCE market, immutable contracts) is tested on Robinhood Testnet and on a mainnet fork and is not deployed on mainnet.

---

## 2. Core Value Proposition & Problem Solved

### The Problem

- **Event markets are hard to settle cleanly.** Many markets resolve through discretion or a dispute process. A buyer cannot tell in advance which document or number will decide the outcome.
- **Trading can continue after the answer is known.** Without a hard cutoff and a delay before the report, informed traders can trade against pools that have not caught up.
- **Single-signature oracles are brittle.** One leaked or broken signing key can forge a report.
- **Event risk and asset risk are usually separate.** A trader who wants a view on both an event and ETH normally needs two positions on two venues.

### The QTimeline Solution

- **A single public source.** Only the first Form 424B4 can resolve the market. The bot publishes the parsed price, the filing URL, the accession number and a SHA-256 of the response with every report.
- **A hard window, enforced in two places.** The hook rejects swaps outside the window, and the vault rejects `split` outside it, even if the registry status is stale.
- **An 18-hour delay.** The earliest report is accepted 18 hours after the cutoff, long after trading has stopped.
- **Two signatures.** The report needs a classical ECDSA signature and a post-quantum ML-DSA-44 signature. A break of secp256k1 alone cannot forge a report.
- **Conditional ETH.** The ETH-YES and ETH-NO pools let a trader take a view on ETH that only pays out in one outcome, with no liquidation risk, because positions are fully collateralized claims.
- **A defined exit for everyone.** Merge pairs at any time before the result, redeem winners after it, and use cancellation at 50 cents if no result arrives.

---

## 3. End-to-End Application Flow

```
[Trader Wallet]
      │  connect, switch to Robinhood Chain (4663)
      ▼
/market  ── odds read from the YES / NO pool through the Uniswap v4 Quoter (refresh 20 s)
      │  choose "Bet on the outcome" or "Trade ETH", YES or NO, an amount
      ▼
TimelineRouter ── checks config hash, status, deadline, nonce, minimum output
      │
      ├─ buyProbability    split USDG → swap the unwanted side → send claims
      ├─ sellProbability   swap part of the position → merge the pair → return USDG
      ├─ tradeAsset        split USDG → swap into ETH claims of one world
      └─ closeConditional  swap ETH claims back → merge with the paired claim
      ▼
Uniswap v4 PoolManager ── IpoTimelineHook.beforeSwap
      │                      reads IpoMarketRegistry, rejects outside [opensAt, cutoffAt)
      ▼
ConditionalVault ── holds collateral, mints and burns the four claim tokens

   ── cutoffAt: swaps stop ──────────────────────────────────────────────────────

[Resolver bot, GitHub Actions, every 15 min on 19-21 Nov from 13:00 UTC]
      │  find the first Form 424B4 on SEC EDGAR
      │  parse the offering price → cents, hash the evidence
      │  sign the digest with ECDSA and with ML-DSA-44
      ▼
IpoResolutionAdapter.reportValue
      │  recover the ECDSA signer, verify ML-DSA-44 through MLDSA44Verifier
      ▼
IpoMarketRegistry ── Final YES if cents ≥ 7400, otherwise Final NO
      ▼
/positions ── redeem winning claims 1 : 1, or all claims at 50 cents if cancelled
```

**Market creation flow (treasury):** a market config signed with ECDSA and ML-DSA-44 goes to `IpoMarketFactory.createMarket`, a CREATE2 salt is mined for the hook permission bits, pools are initialized, collateral is split once, three Uniswap v4 positions are minted as ERC-721 through the PositionManager, and `activateMarket` opens the schedule. Creation of the live market took 17 transactions.

---

## 4. Key Architectural Components

### A. Core Smart Contracts (`contracts/src/ipo/`)

| Contract | Role |
|---|---|
| **IpoMarketFactory** | Verifies the dual-signed creation config, deploys the vault, claim tokens and hook, initializes the three pools, activates the market. Rejects collateral caps above 0.1 ETH and 500 USDG |
| **IpoMarketRegistry** | Market state machine: Draft, Scheduled, Open, Awaiting result, Final YES, Final NO, Cancelled. `syncTime` is permissionless |
| **IpoConditionalVault** | Holds collateral and mints four claim tokens. `split`, `merge`, `redeem`. Rejects `split` outside the trading window |
| **IpoOutcomeToken** | Claim token. Only its vault can mint or burn |
| **IpoTimelineHook** | Hook flags `0x2880`: `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap`. Rejects swaps outside the window with `MarketNotTradable` |
| **IpoHookDeployer** | Deploys the hook proxy at a CREATE2 address matching the v4 permission bits |
| **IpoTimelineRouter** | The trade entry point with config-hash, status, deadline, nonce and slippage checks |
| **IpoResolutionAdapter** | `reportValue` verifies both signatures; `cancelExpired` is callable by anyone after the deadline |
| **IpoPQKeyRegistry** | Registered ML-DSA-44 public keys, sealed after setup |
| **MLDSA44Verifier** | FIPS 204 ML-DSA-44 verifier (Fireblocks Labs implementation, 23,991 bytes) |

### B. Canonical Dependencies

Uniswap v4 PoolManager, PositionManager and Quoter, USDG (6 decimals) and WETH on Robinhood Chain. Addresses are in section 6.

### C. Web Application (`apps/web/`)

A statically exported Next.js site. `NEXT_PUBLIC_EVENT_PROFILE=ipo` selects the IPO copy, threshold and cutoff. The market page leads with the question and a one-tap **Buy YES / Buy NO** card. The seam of that card sits at the market price, and a ruler shows the $74 threshold on the price line. The trade ticket supports two modes (**Bet on the outcome**, the default, and **Trade ETH**), buy and sell, and YES or NO. Wallet discovery uses EIP-6963 with a legacy `window.ethereum` fallback. All times are shown in US Eastern time.

### D. Resolver (`ops/resolver/`)

Parsers for SEC Form 424B4 cover pages and BEA releases, an evidence builder, and the signing and submission path. The IPO workflow `.github/workflows/resolve-mainnet-ipo.yml` runs in the protected `robinhood-mainnet-ipo` Environment. Scheduled runs broadcast; manual runs default to simulation and need an explicit `broadcast` input.

---

## 5. Technology Stack

- **Web:** Next.js 15.5 (static export), React 19, TypeScript 5.9 (strict), viem 2.57, GSAP, Lenis, three.js
- **Contracts:** Solidity 0.8.30, EVM `osaka`, via-IR, optimizer 10,000 runs, Foundry 1.7.1
- **AMM:** Uniswap v4 core 1.0.2 and periphery 1.0.3
- **Libraries:** OpenZeppelin Contracts and Upgradeable 5.4.0
- **Signatures:** ECDSA secp256k1 and ML-DSA-44 (FIPS 204)
- **Resolver:** Node 24 on GitHub Actions
- **Hosting:** Vercel
- **Workspace:** pnpm 9.15

---

## 6. Live Mainnet Contract Addresses (Robinhood Chain 4663)

Explorer: https://robinhoodchain.blockscout.com

### Core system

| Contract | Address | Deploy block |
|---|---|---|
| IpoMarketFactory (proxy) | `0xDb882dBD0da7ed65d4C360b5B18B9bd93ceAFde6` | 114,258,173 |
| IpoMarketRegistry (proxy) | `0x5444CF6E91462938C975668266c9E24b6233BD37` | 114,258,161 |
| IpoResolutionAdapter (proxy) | `0x741C847f54CeebD6A4D1A32341f73fb62eb80fbA` | 114,258,179 |
| TimelineRouter (proxy) | `0x401a0A3A8e32ABaA7f66EE7247D592f47784DF45` | 114,258,185 |
| PQKeyRegistry (proxy) | `0x78F42d96AD69Ed3D696875CF59eFF8A447Cd80A8` | 114,258,167 |
| MLDSA44Verifier | `0x668Fe10f9b424349FDD41F7E6C5DF2cC21Bf3214` | 114,257,982 |
| IpoHookDeployer | `0xaAa28FA6a7DB709129879c1daF13Bc90B843064f` | 114,258,133 |
| F1600Helper | `0x0438deB1f25BA0D88D257acfe89191B3EB3de75F` | 114,257,972 |

### Implementations and beacons

| Item | Address |
|---|---|
| IpoMarketRegistry implementation | `0x430fa4A5C4b013aD16974e4846b55aD3dfA02EeE` |
| IpoPQKeyRegistry implementation | `0x5B0f7981EC187C0e95977693C9418387aF4d5897` |
| IpoMarketFactory implementation | `0x68E6e6689502c7ff4D05F0569c6c72066AdFD164` |
| IpoResolutionAdapter implementation | `0xE8120d3e02c48eA95066b4d6dbE89427Ab80196A` |
| IpoTimelineRouter implementation | `0x74E9B2F75a0BACeA0974D63806DBbfA95BA221F1` |
| IpoConditionalVault implementation | `0x6B690Cc6e05de26A617ea530bA068B556489E889` |
| IpoOutcomeToken implementation | `0xa8801A0cf08D21752331BA241198ed6e6De35584` |
| IpoTimelineHook implementation | `0xc79062f4a0A67142c84F042b4aE85952A4A0A880` |
| Outcome token beacon | `0xCD8B0EB1025215A7C64af28D1Aa45b9f12a44214` |
| Vault beacon | `0x326be2C0e8883dd7b24d3afD17d9f37B3D512329` |
| Hook beacon | `0xa9928908754d2876613787E362bc35DA559C97FE` |

ProxyAdmin addresses are in `deployments/robinhood-mainnet-ipo.json` under `upgradeControl`.

### The live market

| Item | Value |
|---|---|
| Market ID | `0x19d1b881668c8c8c776c92c1745daf74933b2c40c82065ba5f6017ee5e6aeafa` |
| Threshold | $74.00 (`7400` cents) |
| Hook | `0x35A5E21FC31614a30f88D10CC35e5cD5829E2880` |
| Vault | `0x7ACf9Dca7A456175ED66BbEc8B8600C9Fe6e5c0d` |
| ETH-YES claim | `0xE186dc05674B798deDF7059644E84A5c8F6144Eb` |
| ETH-NO claim | `0xe1d59cf537e8b2EB51911ea3733D8b9Ce8Ec4bD6` |
| USDG-YES claim | `0x45eB501957E64f5C732a9A30Cded87B77C1C5076` |
| USDG-NO claim | `0x75F443e26421c0c024AA3745CF074D43375e8001` |
| LP position NFTs | 4311004, 4311005, 4311006 (PositionManager) |
| Created | block 116,738,977, tx `0x7f004edbc4d5a255036b785b421f739406150bfeaf9685c99ac1804b40c6fb77` |
| Activated | block 116,739,091, tx `0x5344cff69d110ec3d97b511f0b354431be1c4da99a31d5d5a830c0c5cc085c0c` |
| Opens | 17 Nov 2026, 18:03:39 UTC (13:03 ET) |
| Closes | 18 Nov 2026, 12:00 UTC (07:00 ET) |
| Earliest report | 19 Nov 2026, 06:00 UTC |
| Cancellation opens | 21 Nov 2026, 06:00 UTC |

### Canonical dependencies

| Dependency | Address |
|---|---|
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Uniswap v4 PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` |
| Uniswap v4 Quoter | `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

### Roles

| Role | Address |
|---|---|
| Deployer; owner of every ProxyAdmin and beacon; holder of the LP position NFTs | `0x3B06A7c6839dF369d62961DcA54ea56185332828` |
| Resolver signer (ECDSA) | `0xB1eeCD3799E929c01aA0aeCbb6CaDEC6d5a30801` |

The report relayer is a separate wallet that pays gas only.

---

## 7. Security, Trust & Risk Controls

### Controls enforced by the contracts

- **Dual-signature resolution.** ECDSA and ML-DSA-44 both must verify in `IpoResolutionAdapter`.
- **Source and period binding.** A report must carry the IPO source ID and the market's period, and it is bound to the adapter's EIP-712 domain. A Core PCE report cannot resolve the IPO market.
- **Trading window.** `IpoTimelineHook` rejects swaps outside the window. `IpoConditionalVault` rejects `split` outside it.
- **Config binding.** Each trade carries the market's config hash.
- **Collateral caps.** The factory refuses caps above 0.1 ETH or 500 USDG.
- **Exit paths.** The hook has no `beforeRemoveLiquidity`. Pairs can merge before the result. Anyone can call `cancelExpired` after the deadline, and every claim then redeems for 50 cents.

### Trust assumptions

- **Upgradeable contracts.** The registry, key registry, factory, adapter and router are OpenZeppelin `TransparentUpgradeableProxy` instances. Each market's vault, claim tokens and hook are `BeaconProxy` instances behind three `UpgradeableBeacon`s. The deployer wallet owns every ProxyAdmin and beacon with no timelock, so it can replace logic, including the vault logic that holds collateral. This is a trust assumption on one key. Core PCE has no such powers.
- **Project-operated resolver.** Both resolver keys are controlled by the project. The dual signature protects against the loss of one key, not against the operator.
- **No independent audit.** No independent security audit or cryptographic review has been completed. See the release gates in `docs/OPERATIONS.md`.
- **Single-source ETH reference price.** The pools open at a reference ETH price taken at seeding time (1,778.03 USDG per ETH). Until traders move them, the ETH pools can differ from the market price of ETH.

### Market risk to disclose

- **Thin opening liquidity.** The treasury seeded 28 USDG and about 0.0045 ETH. Measured on mainnet after opening, a $5 trade moves the price by about 3.1% in the YES / NO pool and about 6.3% in the ETH pools, before the 0.30% fee. Larger trades move prices much more.
- **Treasury is the counterparty.** The seed liquidity takes the other side of trades. If the market moves toward the correct answer, the treasury loses on the YES / NO pool. The maximum loss from the event is bounded by the size of that pool.
- **Claim redemption depends on a valid report.** If the filing is not published in the accepted window, the market cancels at 50 cents.

---

## 8. Verification & Quality Assurance

### Automated tests (local run, 18 Nov 2026)

| Suite | Result |
|---|---|
| Foundry unit, fuzz and invariant (`pnpm contracts:test`) | 52 passed, 0 failed, 2 skipped (fork-only) |
| Foundry mainnet fork (`pnpm contracts:test:mainnet-fork`) | 9 passed, 0 failed |
| Release and withdrawal scripts (`pnpm contracts:test:release`) | 18 passed |
| Resolver (`pnpm --filter @qtimeline/resolver test`) | 27 passed |
| TypeScript (`tsc --noEmit`, `apps/web`) | exit code 0 |

The fork suites run against the official Robinhood PoolManager and USDG. They exercise the Core PCE contracts with the ML-DSA verifier stubbed. The IPO contracts are covered by `contracts/test/IpoMarket.t.sol` and by the fork rehearsal below.

### Fork rehearsal of the live IPO system

Run on a local fork of Robinhood Mainnet with the real IPO contracts, the real ML-DSA verifier and the production scripts:

- Market creation, seeding and activation with the live parameters, and a full liquidity withdrawal that returned the collateral (USDG back to within about $0.000002 of the amount put in, ETH back in full).
- Trades through the production web UI in every direction, using a test wallet: buy and sell the outcome (YES and NO), buy and sell conditional ETH (both pools). All transactions succeeded.
- Swaps rejected after the cutoff.
- The production resolver replaying a saved real Form 424B4 (Circle, $31.00) to **Final NO**, and the same filing edited to $78.00 to **Final YES**. Redemption and treasury exit worked in both outcomes.
- A bug found during this rehearsal: the upper swap price limit used by the web app was a truncated constant, which made some ETH sells revert. The fix is in commit `915be4a` and is deployed.

These are fork results. They are not mainnet transactions by users.

### Mainnet checks

- Plan, market creation (17 transactions, about 6.2M gas, about 0.00013 ETH at the live gas price), seeding and activation, read back from chain.
- The bytecode of every core address was read back from chain 4663.
- Quotes on mainnet after opening: $5 trade impact 3.12% (buy YES or NO) and 3.23% (exit) in the YES / NO pool, 6.31% in each ETH pool direction.
- The resolver workflow ran as a dry run on GitHub Actions: 27 resolver tests passed, the contracts built, and the poll reported "no 424B4 on EDGAR yet".
- The live site reads the market through a keyed RPC and shows the question, the opening price and the time in US Eastern time.

### Known limitations

- The Positions page was not re-checked in a visible browser tab after a merge. In a hidden tab the number animation did not update, while the onchain balance was correct.
- QTL voting is unavailable until the QTL token is verified.
- No fiat on-ramp. A trader needs USDG and a little ETH on Robinhood Chain.
- The public Robinhood RPC is blocked or intercepted by some ISPs and DNS resolvers, so the production site uses a keyed RPC.
