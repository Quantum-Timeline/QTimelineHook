# QTimeline: Project Report & Architecture Overview

**Prediction markets on Uniswap v4 for Robinhood Chain (EVM Mainnet 4663)**

Report date: 24 Nov 2026

- **Web Application:** https://www.qtimeline.tech (apex `qtimeline.tech` → 308 redirect)
- **Market Terminal:** https://www.qtimeline.tech/market/
- **Positions (claims, merge, redeem):** https://www.qtimeline.tech/positions/
- **Rules & Risks:** https://www.qtimeline.tech/rules/
- **GitHub Repository:** https://github.com/Quantum-Timeline/QTimelineHook (branch `main`)
- **Mainnet Manifest:** `deployments/robinhood-mainnet-ipo.json`

---

## 1. Project Description

**QTimeline** is a prediction-market application built natively on **Uniswap v4** for **Robinhood Chain Mainnet (EVM chain 4663)**. It turns one yes-or-no question about a real-world number into three tradable pools, and settles the question onchain from an official release.

The market that is open now asks:

> **Will US Core PCE rise at least 0.30% month over month in October 2026?**

It resolves from the first BEA Personal Income and Outlays release for October 2026, published on **25 Nov 2026 at 13:30 UTC** (08:30 ET). The mechanics:

1. **Claims instead of bets.** A vault splits one USDG (or one ETH) into a YES claim and a NO claim. After the result, the winning claim redeems 1 : 1 and the losing claim redeems for zero. Matching pairs can merge back into collateral before the result.
2. **Three Uniswap v4 pools per market.**
   - **ETH-YES:** the price of ETH in the world where the threshold is met.
   - **ETH-NO:** the price of ETH in the world where it is not.
   - **YES / NO:** the market's implied odds.
   Each pool has a 0.30% LP fee and no protocol fee.
3. **A hook that closes the window.** A per-market hook rejects swaps before `opensAt` and from `cutoffAt` onward, including swaps sent straight to the PoolManager. Trading stops 5 minutes before the release.
4. **Dual-signature resolution.** A bot reads the release, converts the printed Core PCE to basis points, hashes the evidence, and signs the report with ECDSA and with ML-DSA-44 (NIST FIPS 204). `IpoResolutionAdapter` finalizes the market only when both signatures verify onchain and the report comes from the source the market is bound to.
5. **Cancellation as a safety net.** If no valid report arrives before the deadline, anyone can cancel and every claim redeems for 50 cents.

### One engine, many events

The deployed contracts are a **shared event engine**. A new event is a new market on the same contracts, not a new deployment:

- each market is **bound to one data source** with `setMarketSource` (once, by the deployer, before the earliest report). The adapter rejects a report from any other source;
- each market carries **its own schedule** inside fixed bounds (cutoff to earliest report 5 minutes to 7 days, reporting window 1 to 14 days, at least 12 hours of trading);
- thresholds are **signed integers**, so a source other than the SEC may report zero or a negative value;
- outcome tokens have neutral names, for example "QTimeline ETH YES".

The first market on the engine asked whether Anthropic's final IPO price would be at or above $74.00. No Form 424B4 was reported before the 21 Nov deadline, so it was **cancelled**, and every claim redeems for 50 cents. It is listed as a past market in the app. Contract names keep the `Ipo` prefix from that first market.

The repository also holds the original **Core PCE system** (immutable contracts under `contracts/src/`), tested on Robinhood Testnet and on a mainnet fork and not deployed on mainnet. The live Core PCE market runs on the shared engine.

---

## 2. Core Value Proposition & Problem Solved

### The Problem

- **Event markets are hard to settle cleanly.** Many markets resolve through discretion or a dispute process. A buyer cannot tell in advance which document or number will decide the outcome.
- **Trading can continue after the answer is known.** Without a hard cutoff and a delay before the report, informed traders can trade against pools that have not caught up.
- **Single-signature oracles are brittle.** One leaked or broken signing key can forge a report.
- **Event risk and asset risk are usually separate.** A trader who wants a view on both an event and ETH normally needs two positions on two venues.
- **Each new event usually needs new contracts.** That adds audit surface and delay.

### The QTimeline Solution

- **A single public source per market.** For Core PCE only the first BEA release can resolve the market. The bot publishes the parsed value, the release URL and a SHA-256 of the response with every report.
- **A hard window, enforced in two places.** The hook rejects swaps outside the window, and the vault rejects `split` outside it, even if the registry status is stale.
- **A delay before the report.** The earliest report is accepted at the release time, after trading has stopped.
- **Two signatures.** The report needs a classical ECDSA signature and a post-quantum ML-DSA-44 signature. A break of secp256k1 alone cannot forge a report.
- **Conditional ETH.** The ETH-YES and ETH-NO pools let a trader take a view on ETH that only pays out in one outcome, with no liquidation risk, because positions are fully collateralized claims.
- **A defined exit for everyone.** Merge pairs at any time before the result, redeem winners after it, and use cancellation at 50 cents if no result arrives.
- **New events without redeploying.** One engine, one market per event.

---

## 3. End-to-End Application Flow

```
[Trader Wallet]
      │  connect, switch to Robinhood Chain (4663)
      ▼
/market  ── odds read from the YES / NO pool through the Uniswap v4 Quoter (refresh 20 s)
      │  choose "Bet on the outcome" or "Trade ETH · advanced", YES or NO, an amount
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

   ── cutoffAt 13:25 UTC: swaps stop ───────────────────────────────────────────

[Resolver bot, GitHub Actions, every 15 min on 25-27 Nov from 13:00 UTC]
      │  poll the BEA release for October 2026 (404 until it is published)
      │  parse Core PCE month over month → basis points, hash the evidence
      │  check the market is bound to the BEA source on chain
      │  sign the digest with ECDSA and with ML-DSA-44
      ▼
IpoResolutionAdapter.reportValue
      │  check the bound source, recover the ECDSA signer, verify ML-DSA-44 through MLDSA44Verifier
      ▼
IpoMarketRegistry ── Final YES if bps ≥ 30, otherwise Final NO
      ▼
/positions ── redeem winning claims 1 : 1, or all claims at 50 cents if cancelled
```

**Market creation flow (treasury):** a market config signed with ECDSA and ML-DSA-44 goes to `IpoMarketFactory.createMarket`, the deployer binds the data source with `setMarketSource`, a CREATE2 salt is mined for the hook permission bits, pools are initialized, collateral is split once, three Uniswap v4 positions are minted as ERC-721 through the PositionManager, and `activateMarket` opens the schedule. The Core PCE market took 9 transactions and about 5.95M gas.

---

## 4. Key Architectural Components

### A. Core Smart Contracts (`contracts/src/ipo/`)

| Contract | Role |
|---|---|
| **IpoMarketFactory** | Verifies the dual-signed creation config, deploys the vault, claim tokens and hook, initializes the three pools, activates the market. Accepts per-market schedules inside the bounds and signed thresholds. Rejects collateral caps above 0.1 ETH and 500 USDG |
| **IpoMarketRegistry** | Market state machine: Draft, Scheduled, Open, Awaiting result, Final YES, Final NO, Cancelled. Schedule bounds as constants. `syncTime` is permissionless |
| **IpoConditionalVault** | Holds collateral and mints four claim tokens. `split`, `merge`, `redeem`. Rejects `split` outside the trading window |
| **IpoOutcomeToken** | Claim token. Only its vault can mint or burn |
| **IpoTimelineHook** | Hook flags `0x2880`: `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap`. Rejects swaps outside the window with `MarketNotTradable` |
| **IpoHookDeployer** | Deploys the hook proxy at a CREATE2 address matching the v4 permission bits |
| **IpoTimelineRouter** | The trade entry point with config-hash, status, deadline, nonce and slippage checks |
| **IpoResolutionAdapter** | `setMarketSource` and `expectedSource` bind a market to one source. `reportValue` verifies both signatures and the source; non-SEC sources may report zero or negative values. `cancelExpired` is callable by anyone after the deadline |
| **IpoPQKeyRegistry** | Registered ML-DSA-44 public keys, sealed after setup |
| **MLDSA44Verifier** | FIPS 204 ML-DSA-44 verifier (Fireblocks Labs implementation, 23,991 bytes) |

### B. Canonical Dependencies

Uniswap v4 PoolManager, PositionManager and Quoter, USDG (6 decimals) and WETH on Robinhood Chain. Addresses are in section 6.

### C. Web Application (`apps/web/`)

A statically exported Next.js site. One build shows one event, selected by build variables (`NEXT_PUBLIC_EVENT_PROFILE`, `NEXT_PUBLIC_EVENT_KIND`, `NEXT_PUBLIC_MARKET_ID`, `NEXT_PUBLIC_EVENT_THRESHOLD_BPS`, `NEXT_PUBLIC_EVENT_PERIOD_LABEL`, `NEXT_PUBLIC_EVENT_CUTOFF_AT`). The landing page states what the app is in one line and includes a **Release day** section that shows the four moments of a market and the three ways it ends. The market page leads with the question and a one-tap **Buy YES / Buy NO** card, with a ruler for the threshold. The trade ticket supports two modes (**Bet on the outcome**, the default, and **Trade ETH · advanced**), buy and sell, and YES or NO. A **Past markets** section lists ended markets and opens their claims on the Positions page (`?id=<marketId>`). Wallet discovery uses EIP-6963 with a legacy `window.ethereum` fallback. All times are shown in US Eastern time.

### D. Resolver (`ops/resolver/`)

Parsers for SEC Form 424B4 cover pages and BEA releases, an evidence builder, and the signing and submission path. The shared workflow `.github/workflows/resolve-mainnet-event.yml` runs in the protected `robinhood-mainnet-ipo` Environment. The data source is chosen per run (`QT_EVENT_SOURCE=sec|bea`), and the resolver refuses to sign when the market is not bound to that source onchain. Scheduled runs broadcast; manual runs default to simulation and need an explicit `broadcast` input.

### E. Delivery

The static site is deployed to **Cloudflare Pages** (project `qtimeline`) by `.github/workflows/deploy-web.yml` on every push to `main` that touches the web app. Production build variables are GitHub repository variables, and the RPC URL is a secret. `www.qtimeline.tech` is a CNAME to the Pages project.

---

## 5. Technology Stack

- **Web:** Next.js 15.5 (static export), React 19, TypeScript 5.9 (strict), viem 2.57, GSAP, Lenis, three.js
- **Contracts:** Solidity 0.8.30, EVM `osaka`, via-IR, optimizer 10,000 runs, Foundry 1.7.1
- **AMM:** Uniswap v4 core 1.0.2 and periphery 1.0.3
- **Libraries:** OpenZeppelin Contracts and Upgradeable 5.4.0
- **Signatures:** ECDSA secp256k1 and ML-DSA-44 (FIPS 204)
- **Resolver:** Node 24 on GitHub Actions
- **Hosting:** Cloudflare Pages, deployed from GitHub Actions
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

Current implementations, confirmed by reading the proxies from chain on 24 Nov 2026:

| Item | Address |
|---|---|
| IpoMarketRegistry implementation | `0x7055Eb3b51589c6715ca6AD119fa8547cE14D202` (upgraded 24 Nov, was `0x430fa4A5C4b013aD16974e4846b55aD3dfA02EeE`) |
| IpoMarketFactory implementation | `0x20499D3fB06Fd0830553eBf8Aac0BF52A6ea852a` (upgraded 24 Nov, was `0x68E6e6689502c7ff4D05F0569c6c72066AdFD164`) |
| IpoResolutionAdapter implementation | `0x0087A0a7544322c0361616Ca1C7f5cf8Fd95d529` (upgraded 24 Nov, was `0xE8120d3e02c48eA95066b4d6dbE89427Ab80196A`) |
| IpoPQKeyRegistry implementation | `0x5B0f7981EC187C0e95977693C9418387aF4d5897` |
| IpoTimelineRouter implementation | `0x74E9B2F75a0BACeA0974D63806DBbfA95BA221F1` |
| IpoConditionalVault implementation | `0x6B690Cc6e05de26A617ea530bA068B556489E889` |
| IpoOutcomeToken implementation | `0xa8801A0cf08D21752331BA241198ed6e6De35584` |
| IpoTimelineHook implementation | `0xc79062f4a0A67142c84F042b4aE85952A4A0A880` |
| Outcome token beacon | `0xCD8B0EB1025215A7C64af28D1Aa45b9f12a44214` |
| Vault beacon | `0x326be2C0e8883dd7b24d3afD17d9f37B3D512329` |
| Hook beacon | `0xa9928908754d2876613787E362bc35DA559C97FE` |

Upgrade transactions (24 Nov 2026): adapter `0xd45f18da317de6402d3289c95d89b54b9a66cc58013ea8ffdb74189f9b13d5d5`, registry `0x078eace72a6d9ad6491dc0cd609275e35bc02d4ce0a0048bb77f4b859bcd4aea`, factory `0xa38e4a2b0bc4be934420172ce2f651cda962d1b2ddeebceca37fb3804fa9c59a`. The manifest's `implementations` block records the original addresses and `upgradeHistory` records the upgrades. ProxyAdmin addresses are in `deployments/robinhood-mainnet-ipo.json` under `upgradeControl`.

### The live market: US Core PCE, October 2026

| Item | Value |
|---|---|
| Market ID | `0xc8fdedaeb42752167dd111603983166c4529ae4da59820328fa75385cac4fcee` |
| Period | `CORE-PCE-2026-10` |
| Threshold | 0.30% (`30` basis points) |
| Bound source | `bea:core-pce:mom:first-release` (`expectedSource` reads back `0xc315c6d1…06af84`, the keccak256 of that string) |
| Hook | `0x824Bc382bEfbF478BA24309C0CF68C04a2F76880` |
| Vault | `0xA127EeB1084623E8C6d141501410Fde98164C3Ab` |
| ETH-YES claim | `0xCcC3bd893c5aa1A4eE109Be4FAc2655E615d446B` |
| ETH-NO claim | `0xF036A7677904a2fe7807b792f092633243Ba0119` |
| USDG-YES claim | `0x928FaB302AFe89a571E99eBaFcaA6E0818d3ba76` |
| USDG-NO claim | `0x58564d1C266139e28fb46387fFfb1c9AbBf383c6` |
| LP position NFTs | 4355306, 4355307, 4355308 (PositionManager) |
| Opening seed | 28 USDG and about 0.0045 ETH; ETH reference price 1,778.03 USDG |
| Created | block 122,102,641, tx `0x82822c94374eb066a29ddf8810c7e81f913a1bbee3ac128bfc04d5140bc48644` |
| Source bound | tx `0x9c1d93dda63a1b32c01bb7925fea09fe16c21c45fc16413dd2dbc45a52eb577f` |
| Activated | tx `0xcf277d13786969ad3fb1771ffe7c664b3685f7457a51d21abbb77c87fdab6b59` |
| Opens | 24 Nov 2026, 09:56:17 UTC |
| Closes | 25 Nov 2026, 13:25 UTC (08:25 ET) |
| Release, earliest report | 25 Nov 2026, 13:30 UTC (08:30 ET) |
| Cancellation opens | 27 Nov 2026, 13:30 UTC |

### The past market: Anthropic IPO price (cancelled)

| Item | Value |
|---|---|
| Market ID | `0x19d1b881668c8c8c776c92c1745daf74933b2c40c82065ba5f6017ee5e6aeafa` |
| Threshold | $74.00 (`7400` cents) |
| Vault | `0x7ACf9Dca7A456175ED66BbEc8B8600C9Fe6e5c0d` |
| Result | Cancelled after the 21 Nov 2026 deadline. Every claim redeems for 50 cents |
| Treasury exit | Liquidity withdrawn on 24 Nov 2026, tx `0x47954e12fd11d083cc846df8410eed42cc9d4d5a3b8db1411efeede9f887a3b2` |

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
- **Source and period binding.** A report must carry the source ID the market is bound to and the market's period, and it is bound to the adapter's EIP-712 domain. An SEC report cannot resolve a BEA market, and the other way round. The binding can be set once, only by the deployer, and only before the earliest report time.
- **Trading window.** `IpoTimelineHook` rejects swaps outside the window. `IpoConditionalVault` rejects `split` outside it.
- **Config binding.** Each trade carries the market's config hash.
- **Collateral caps.** The factory refuses caps above 0.1 ETH or 500 USDG.
- **Schedule bounds.** The registry and factory reject schedules outside the bounds in section 1.
- **Exit paths.** The hook has no `beforeRemoveLiquidity`. Pairs can merge before the result. Anyone can call `cancelExpired` after the deadline, and every claim then redeems for 50 cents.

### Trust assumptions

- **Upgradeable contracts, and they were upgraded.** The registry, key registry, factory, adapter and router are OpenZeppelin `TransparentUpgradeableProxy` instances. Each market's vault, claim tokens and hook are `BeaconProxy` instances behind three `UpgradeableBeacon`s. The deployer wallet owns every ProxyAdmin and beacon with no timelock, so it can replace logic, including the vault logic that holds collateral. The three upgrades of 24 Nov 2026 show that power in use. This is a trust assumption on one key. The original Core PCE system has no such powers.
- **Project-operated resolver.** Both resolver keys are controlled by the project. The dual signature protects against the loss of one key, not against the operator.
- **The data source binding is set by the deployer.** A market is only as safe as the source id the deployer binds it to. The resolver refuses to sign when the on-chain binding does not match.
- **No independent audit.** No independent security audit or cryptographic review has been completed. See the release gates in `docs/OPERATIONS.md`.
- **Single-source ETH reference price.** The pools open at a reference ETH price taken at seeding time (1,778.03 USDG per ETH). Until traders move them, the ETH pools can differ from the market price of ETH.

### Market risk to disclose

- **Thin opening liquidity.** The treasury seeded 28 USDG and about 0.0045 ETH. In the ETH pools only small trades quote, up to about 5 USDG; larger amounts are rejected with a message in the app. Larger trades also move the YES / NO price much more.
- **Treasury is the counterparty.** The seed liquidity takes the other side of trades. If the market moves toward the correct answer, the treasury loses on the YES / NO pool. The maximum loss from the event is bounded by the size of that pool.
- **Claim redemption depends on a valid report.** If the release is not parsed and reported in the accepted window, the market cancels at 50 cents.

---

## 8. Verification & Quality Assurance

### Automated tests (local run, 24 Nov 2026)

| Suite | Result |
|---|---|
| Foundry unit, fuzz and invariant (`pnpm contracts:test`) | 55 passed, 0 failed, 2 skipped (fork-only) |
| Foundry mainnet fork (`pnpm contracts:test:mainnet-fork`) | 9 passed, 0 failed |
| Release and withdrawal scripts (`pnpm contracts:test:release`) | 18 passed |
| Resolver (`pnpm --filter @qtimeline/resolver test`) | 27 passed |
| TypeScript (`pnpm typecheck`) | exit code 0 |

The engine changes are covered by `contracts/test/IpoMarket.t.sol`: per-event schedules inside the bounds, creation with zero and negative thresholds, source binding (deployer only, once, before the earliest report), unbound markets keeping the original SEC source, and a bound market resolving only from its own source.

### Fork rehearsal of the shared engine

Run on a local fork of Robinhood Mainnet with the real contracts, the real ML-DSA verifier and the production scripts: the three upgrades, the Core PCE market created, seeded and activated with the live parameters, source binding, and the production resolver replaying a saved BEA fixture (0.3% printed, 30 bps) to a **Final YES**. The same fork also withdrew the liquidity of the IPO market. These are fork results. They are not mainnet transactions by users.

### Mainnet checks (24 Nov 2026)

- The three proxy upgrades, the IPO liquidity withdrawal, and the creation, seeding and activation of the Core PCE market (9 transactions, about 5.95M gas), read back from chain.
- The proxies were read back: the adapter, registry and factory point to the new implementations.
- `expectedSource(marketId)` on the adapter returns the keccak256 of `bea:core-pce:mom:first-release`.
- The resolver workflow ran as a dry run on GitHub Actions against mainnet: tests passed and the poll reported "BEA release for 2026-10 is not published yet".
- The live site reads the market from chain and shows the question, the opening price and the schedule in US Eastern time. The site is served by Cloudflare Pages.

### Known limitations

- **The BEA parser has not yet read the October release.** It is tested on archived BEA releases for July and September 2026 and on live 404 responses. The first scheduled run is on 25 Nov 2026 at 13:30 UTC. If parsing fails, there is time until 27 Nov 13:30 UTC to fix the parser before the market can be cancelled.
- QTL voting is unavailable until the QTL token is verified.
- No fiat on-ramp. A trader needs USDG and a little ETH on Robinhood Chain.
- The public Robinhood RPC is blocked or intercepted by some ISPs and DNS resolvers, so the production site uses a keyed RPC.
- On the Positions page, a Merge button stays enabled when you hold only one side of an asset. Clicking it shows a message and sends no transaction.

---

## 9. What Changed Since the First Report (18 Nov 2026)

| Area | Change |
|---|---|
| Market | The Anthropic IPO market was cancelled (no Form 424B4 before the deadline). A US Core PCE market for October 2026 replaced it as the live market |
| Contracts | Three proxies upgraded for per-market source binding, per-market schedule bounds and signed thresholds. No new contracts were deployed |
| Treasury | IPO market liquidity withdrawn. Core PCE market seeded with 28 USDG and about 0.0045 ETH |
| Resolver | One shared workflow for any event, with a per-run source (`sec` or `bea`) and a check that the market is bound to it on chain |
| Web | One-screen hero with a plain description of the app, a Release day section, a Past markets section with a redeem link, a Core PCE link preview image, engine-neutral labels, ETH quick amounts that fit the pool depth, clearer quote errors |
| Delivery | Hosting moved from Vercel to Cloudflare Pages with automatic deploys from GitHub Actions |
