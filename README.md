# QTimeline

QTimeline is a conditional-market application for Uniswap v4 on Robinhood Chain. Its implementation decisions are in [QTimeline-Implementation-Plan.md](./QTimeline-Implementation-Plan.md); the earlier product brief is retained as background.

## Workspace

- `apps/web` â€” statically exported Next.js site (`/`, `/market/`, `/positions/`, `/vote/`, `/rules/`).
- `contracts` â€” Solidity market registry, collateral vault, outcome tokens and hybrid-resolution adapter.
- `packages/chain` â€” Robinhood Chain config and shared registry ABI.
- `ops/resolver` â€” BEA first-release parser and evidence preparation.

## Local commands

After cloning, initialize the Solidity verifier dependency with `git submodule update --init --recursive`.

```sh
pnpm install
pnpm dev
pnpm build
pnpm --filter @qtimeline/resolver test
cd contracts && forge build && forge test
```

For a read-only Robinhood Chain Mainnet release check after filling `contracts/.env`, run `pnpm deploy:mainnet:preflight` (or the compatibility alias `pnpm deploy:preflight`). It checks chain ID, official v4 and token bytecode, USDG/WETH metadata, deployer key/address pairing, distinct resolver identity and seed-bound ML-DSA-44 keys. It reports whether the deployer has ETH for deployment gas; the resolver signer does not pay report gas. It never signs or sends a transaction. A zero deployer balance is reported as not funded and returns a nonzero exit code. `pnpm contracts:test:mainnet-fork` runs constructor and wiring checks against a Mainnet fork.

## Mainnet release preparation

The Mainnet contract deployer is Robinhood Chain ID `4663`; gas is paid in ETH. First run `pnpm contracts:build`, then `pnpm keys:mainnet:prepare`, then `pnpm deploy:mainnet:preflight`. Key preparation generates the resolver ECDSA key, distinct ML-DSA-44 seeds, and prepared verifier blobs under ignored `contracts/.secrets/`. Make and verify an encrypted offline backup before registering either key on-chain. Never copy those files into `apps/web` or a public build.

When ready to send the contract deployment transactions, fund the configured deployer address with enough ETH and run `pnpm deploy:mainnet -- --broadcast`. The script refuses any chain other than 4663, rechecks all signer keys and official contract addresses, validates every build artifact before its first transaction, records each confirmed transaction in `deployments/robinhood-mainnet.json`, registers and seals both PQ keys, wires and seals the market registry, and checks the final wiring by reading it back from chain. It is resumable from that manifest after an interrupted deployment. It does not create a market, initialize pools, seed liquidity, or activate trading.

The resolver ECDSA/ML-DSA signer is separate from the report relayer. The relayer pays gas; use a dedicated low-balance wallet for the GitHub bot, and keep its key in the protected `robinhood-mainnet` Environment. After deployment, commit the public `deployments/robinhood-mainnet.json` manifest so Actions can read its addresses and wiring evidence. The Mainnet worker is `.github/workflows/resolve-mainnet.yml`; it stays disabled until `QTIMELINE_MAINNET_ENABLED=true`, the manifest and active market variables are set, and the five Mainnet secrets in `ops/resolver/README.md` are added. Manual runs default to simulation and require an explicit `broadcast` input to send a report.

## Mainnet market launch

After the base deployment is committed, `contracts/scripts/create-mainnet-market.mjs` creates, seeds and activates the first market (`pnpm market:mainnet:plan`, `pnpm market:mainnet:create`, `pnpm market:mainnet:quote`). Set `QT_MARKET_PERIOD` (`YYYY-MM`), `QT_MARKET_RELEASE_AT` (BEA release time in unix seconds, re-checked against the BEA calendar) and `QT_ETH_USD` (reference ETH price at seeding time). `--broadcast` is resumable from `deployments/robinhood-mainnet.json` and runs: signed `createMarket` (ECDSA + ML-DSA-44, verified against the deployed verifier before sending), `initializePools`, one ETH and one USDG split, Permit2 approvals, three PositionManager mints (about 53 USDG + the same value in ETH per timeline pool, 67 USDG for the probability pool), and `activateMarket`. It refuses to run if the deployer lacks the seed plus gas headroom. After `opensAt`, `pnpm market:mainnet:quote` quotes the official v4 Quoter in all eight directions and exits non-zero if any misses the 1% opening-depth target; run it before announcing the market.

Rehearsal on an Anvil fork of Robinhood Mainnet (real verifier, official PoolManager/PositionManager/Quoter/USDG): the base deploy cost about 36.3M gas, `createMarket` 7.05M, pool initialization 0.20M, seeding three positions about 1.36M, activation 0.08M. The Quoter measured 99 bps (ETH timeline buy and sell), 97 bps (probability buy) and 98 bps (probability exit) of price impact before fee at ETH 2000, all inside the 1% target. The production resolver parsed the live official BEA September 2026 article (0.3%), signed it with both keys, passed simulation, and a broadcast on the fork finalized the market as Final YES for 1,382,773 gas; a rerun was a no-op. Fork gas excludes Robinhood Chain's L1 data fee, which adds only about 1% on contract creations when estimated against the live Mainnet RPC. At the live gas price of about 0.02 gwei the whole base deploy costs roughly 0.0008 ETH and market creation, pool setup and seeding roughly 0.0002 ETH, plus the seed capital itself (about 0.0265 ETH and 120 USDG). An Anvil fork reports a much higher gas price, so do not budget from fork ETH figures.

## Anthropic IPO pricing system (separate from Core PCE)

A second, fully separate system resolves one question: whether the final IPO offering price per share of Anthropic, PBC (Nasdaq: ANT) is at or above a chosen threshold. It has its own contracts, deployment manifest, bot keys, GitHub Environment and static site. Core PCE is unchanged: its eleven contracts compile to identical bytecode before and after this system was added, and none of its source, manifest or tooling was edited.

| | Core PCE | Anthropic IPO pricing |
|---|---|---|
| Contracts | `MarketRegistry`, `MarketFactory`, `ResolutionAdapter` (immutable) | `IpoMarketRegistry`, `IpoMarketFactory`, `IpoResolutionAdapter` in `contracts/src/ipo/`, upgradeable |
| Shared code, new instances | | vault, outcome tokens, hook, router, verifier and key registry, deployed again at new addresses (proxy-based variants) |
| Source of truth | BEA first release, monthly Core PCE | SEC EDGAR final prospectus (Form 424B4), the first one filed, offering price per share |
| Reported value | basis points | US cents (`$74.00` is 7400); the threshold is in cents too |
| Cutoff to earliest report | fixed 5 minutes | constructor parameter, default 18 hours (priced in the evening, filed the next morning) |
| Minimum trading window | fixed 24 hours | constructor parameter, default 12 hours |
| Manifest | `deployments/robinhood-mainnet.json` | `deployments/robinhood-mainnet-ipo.json` (`QTIMELINE_IPO_MANIFEST`) |
| Bot keys | `mainnet-bot-*` | `mainnet-ipo-bot-*`, a different signer; the deployer wallet is shared |
| Workflow and Environment | `resolve-mainnet.yml`, `robinhood-mainnet` | `resolve-mainnet-ipo.yml`, `robinhood-mainnet-ipo` |
| Static site | `apps/web/out` | `apps/web/out-ipo` (`NEXT_PUBLIC_EVENT_PROFILE=ipo`) |

**Upgradeability (IPO system only).** Registry, key registry, factory, adapter and router are OpenZeppelin `TransparentUpgradeableProxy` instances; each market's vault, four claim tokens and hook are `BeaconProxy` instances behind three `UpgradeableBeacon`s (the hook proxy and its implementation are CREATE2-mined for the v4 permission bits through `IpoHookDeployer`). The deployer owns every ProxyAdmin and beacon, so it can replace logic, including vault logic that holds collateral. That is a trust assumption on the deployer key, not a trustless design; the owner can hand over or renounce upgrade rights. Core PCE has no such powers. Upgrade with `QT_IPO_UPGRADE_TARGET=<key> QT_IPO_UPGRADE_CONTRACT=<artifact> pnpm upgrade:ipo [-- --broadcast]`; the manifest records `upgradeControl` and `upgradeHistory`.

**Treasury exit (IPO).** `pnpm withdraw:ipo` prints a read-only plan; `pnpm withdraw:ipo -- --broadcast` removes all three v4 positions and then redeems the claims after a result (Final YES, Final NO or Cancelled). While the market is trading it refuses unless `QT_IPO_ALLOW_EARLY=1`, because pulling liquidity removes every trader's counterparty; in that case pairs are merged back to collateral and unpaired claims wait for the result. Verified on the fork after a Final YES report; the early-merge path is not yet rehearsed.

The adapter rejects a report whose source id is not the IPO source, so a Core PCE report can never resolve the IPO market, and a report signed for one adapter's EIP-712 domain does not verify on the other.

Commands, all mirroring the Core PCE ones: `pnpm keys:ipo:prepare`, `pnpm deploy:ipo:preflight`, `pnpm deploy:ipo -- --broadcast`, `pnpm market:ipo:plan|create|quote`, `pnpm web:ipo:configure`, `pnpm web:ipo:build`, and `pnpm --filter @qtimeline/resolver resolve:ipo`. Schedule parameters are immutable after deployment: `QT_IPO_RELEASE_DELAY_SECONDS`, `QT_IPO_RESOLUTION_WINDOW_SECONDS`, `QT_IPO_MIN_TRADING_SECONDS`. Market inputs are `QT_IPO_CUTOFF_AT` (unix seconds, before the offering is priced), `QT_IPO_THRESHOLD` (dollars) and `QT_ETH_USD`.

Reference timeline for a cutoff at 2026-11-18 12:00 UTC with the defaults: earliest report 2026-11-19 06:00 UTC, cancellation opens 2026-11-21 06:00 UTC, and the market must be activated by 2026-11-18 00:00 UTC. The company's IPO site and the press expect pricing on 18 Nov and first trade on 19 Nov, subject to regulatory clearance; those dates are expectations, not facts, and the bot reads only the SEC filing. If no 424B4 appears before the deadline, anyone can cancel and every claim redeems for 50%.

Evidence on a Mainnet fork (official PoolManager, PositionManager, Quoter and USDG, real ML-DSA verifier): the full deploy, market creation, seeding, activation and quotes in all eight directions (97 to 99 bps impact at ETH 2000) passed; the bot is a quiet no-op against the live EDGAR record while no 424B4 exists; a saved real 424B4 (Circle, $31.00) replayed through the production signing path resolved a $30 market as Final YES for 1,383,910 gas, and a rerun was idempotent. The parser is tested on real 424B4 cover pages and on first-filing selection when a later follow-on 424B4 exists. These are fork results, not Mainnet transactions.

The base contract deploy script does not create a market, initialize pools, seed liquidity, or activate trading. Market launch still needs a current BEA schedule and evidence URL, a funded treasury, the Mainnet resolver secrets, independent security audit and cryptographic review, and legal/hosting review. The quote, gas and resolver dry-run evidence exists from the fork rehearsal above and must be repeated on Mainnet. QTL voting stays unavailable until the real Pons token address is verified and bound. The current fork tests check official core code, token metadata, protocol constructors, and registry/factory wiring; `contracts/test/MainnetForkLifecycle.t.sol` additionally runs market creation, pool initialization, treasury LP seeding, all trade directions, cutoff enforcement (router and direct PoolManager swaps), LP exit, Final YES and cancellation payouts against the official PoolManager and USDG, with the ML-DSA verifier and PQ registry stubbed (the real verifier is covered by the testnet runs). At the plan's seed budget (0.0265 ETH + 53 USDG per timeline pool, 67 USDG for the probability pool, ETH at 2000 USDG) a $5 trade measures 99 bps price impact before fee on the ETH timeline pools, inside the 1% target. Quote and gas numbers are fork measurements, not Mainnet transactions. The release checklist is in §9 of [the implementation plan](./QTimeline-Implementation-Plan.md); do not activate a Mainnet market or accept public funds before those gates pass.

After the Mainnet contracts are deployed and the wiring readback is verified, set `QTIMELINE_PUBLIC_MAINNET_RPC` to an HTTPS browser-safe RPC endpoint and run `pnpm web:mainnet:configure`; this writes ignored `apps/web/.env.mainnet.local` from the deployment manifest without touching the testnet `.env.local`. Then run `pnpm web:mainnet:build` to create the static Mainnet export. The generated site intentionally has no active market or election ID until those are created and configured.

The current testnet deployment is recorded in `deployments/robinhood-testnet-v2.json`. `pnpm deploy:testnet` is restricted to chain ID `46630`; it reuses that deployment, uses the QTimeline USDG faucet token, and provisions test-only ML-DSA keys. Generated test signing keys stay under ignored `contracts/.secrets/`.

Testnet lifecycle checks were run on Robinhood Chain Testnet (chain ID 46630) with the synthetic event configured in apps/web/.env.local. The short-market timing is five minutes of trading, ten seconds from cutoff to release, and a two-minute resolution window. No Mainnet deployment or transaction was used.

The test manifests record separate runs: robinhood-testnet-short.json covers probability and ETH conditional trading plus expiry cancellation and 50/50 redemption; robinhood-testnet-fixed-vault.json covers both-sided trading, a signed synthetic Final YES report, winning payout, and zero-payout losing-claim burn; robinhood-testnet-final-no.json covers a signed synthetic Final NO report and the inverse redemption results. The ConditionalVault fix is deployed in the fixed-vault and final-no stacks. Foundry tests cover both final outcomes, partial claims, cap enforcement, invalid collateral, and short-market lifecycle behavior.

LP exit was also exercised against the resolved Final YES stack: all three treasury v4 positions were fully removed after cutoff/finality, each PositionManager liquidity read back as zero, and all four resulting ETH/USDG YES/NO claims were redeemed. The receipt and per-outcome amounts are recorded in `smokeMarket.liquidityWithdrawal` in `deployments/robinhood-testnet-fixed-vault.json`. Repeat with `QTIMELINE_TESTNET_MANIFEST=deployments/<manifest>.json pnpm withdraw:testnet`; the script refuses non-testnet chains, non-final markets, or positions not owned by the manifest deployer.

`deployments/robinhood-testnet-cutoff.json` is an isolated fresh-stack run. Its normal trade smoke passed, then after cutoff the v4 Quoter's callback to `PoolManager.swap` was rejected by `TimelineHook` with the decoded `MarketNotTradable` error (bypassing TimelineRouter). Treasury liquidity was withdrawn while the market was AwaitingResult, all three positions read back as zero, and after the resolver deadline the market was cancelled with half payout for all four ETH/USDG outcomes. The cutoff and cancellation transactions and receipts are recorded in that manifest. The cutoff check can be repeated with `QTIMELINE_TESTNET_MANIFEST=deployments/<manifest>.json pnpm cutoff:testnet`.

The resolver parser is tested against archived official BEA HTML fixtures for July 2026 (20 bps) and September 2026 (30 bps); fixture source URLs and SHA-256 values are in `ops/resolver/test/fixtures/README.md`.

`deployments/robinhood-testnet-resolver-negative.json` records an additional short run: wrong ECDSA signer, wrong ML-DSA digest, wrong EIP-712 chain domain, wrong report period, evidence-hash mismatch, expired signature, valid hybrid Final YES report, and duplicate report rejection. All three LP positions were withdrawn after finality and the resulting YES/NO ETH/USDG claims were redeemed.

`deployments/robinhood-testnet-stale-status.json` records a fresh stack using the cutoff guard in the current `ConditionalVault`: after the market's cutoff timestamp, while its registry status remained stale `Open`, `simulateContract` rejected both native ETH and USDG `split` calls with `InvalidState`. The same stack then passed the six negative resolver checks and a valid synthetic Final YES report; all three LP positions were withdrawn to zero and all four ETH/USDG YES/NO claims were redeemed, with winning payouts and zero-payout losing-claim burns recorded in the manifest.

That same isolated stack also records a test QTL token binding and the complete short voting path: deposit 1 QTL, vote for candidate A, finalize, and withdraw the full escrow.

Current local verification: 29 Foundry tests pass including fuzz and invariant tests for the vault (the Mainnet fork suites are skipped in the local unit run; 9 pass on the fork); 7 release and withdrawal Node tests pass; 2 Mainnet fork checks pass; the Solidity build, Next.js production export, and TypeScript typecheck pass. The cancellation rounding test records the specified per-claim floor: two odd 5-wei claims return 2 wei each, leaving 1 wei of collateral accounting dust.

For another isolated short run, set QTIMELINE_TESTNET_MANIFEST to a new manifest path, then use pnpm deploy:short-testnet and pnpm seed:short-testnet. Run pnpm trade:short-testnet while the market is open. Run pnpm resolve:short-testnet after releaseAt; set QTIMELINE_TEST_RESULT=NO for a synthetic Final NO report. Run pnpm cancel:short-testnet only after deadline. Governance uses a separate QTL voting token and short election; the fixed-vault stack records deposit, vote, finalize, and withdraw receipts.

The active local web environment targets `deployments/robinhood-testnet-current-vault.json`. The static site displays the synthetic event labels and reads lifecycle status and quotes from Robinhood Chain.

The testnet manifests record synthetic short-market lifecycle tests only; their 1:1 raw-unit pool prices do not represent economic prices. The Mainnet deployment path is prepared and fork-checked, but no Mainnet contracts or market have been deployed. Mainnet market activation remains gated on audit, independent cryptographic review, current quote and gas evidence, resolver operations, and legal/hosting review.

Copy `.env.example` to local environment configuration only when needed. Browser RPC values are public and are embedded in static assets. Signing keys belong only in the isolated resolver environment and must never enter the frontend build. Candidate labels in the voting UI are shown only when their configured bytes32 IDs match the on-chain election.


