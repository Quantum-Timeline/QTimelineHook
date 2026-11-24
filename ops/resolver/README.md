# Resolver bot

## Shared event runner (current)

One resolver serves every market on the shared event engine. It lives in `src/submit-mainnet-ipo.mjs` and runs as `pnpm --filter @qtimeline/resolver resolve:ipo`. The data source is chosen per run:

| `QT_EVENT_SOURCE` | Reads | Bound source id on chain |
|---|---|---|
| `bea` | The BEA Personal Income and Outlays release for `QT_BEA_DATA_PERIOD` (`YYYY-MM`), Core PCE month over month, reported in basis points | `bea:core-pce:mom:first-release` |
| `sec` (default) | The first Form 424B4 on SEC EDGAR, offering price in US cents | the original IPO source |

Before it signs, the runner reads `expectedSource(marketId)` from the adapter and **refuses to sign when the market is not bound to the source it is about to report**. It also checks the chain id, the resolver and relayer, the market period and the deadline. It simulates, sends once, then reads the final status, value and evidence hash back from chain. A run against a market that is already final submits nothing. An unpublished release (404) is a quiet no-op.

The workflow is `.github/workflows/resolve-mainnet-event.yml`. It uses the protected `robinhood-mainnet-ipo` Environment and these secrets: `QT_MAINNET_RPC`, `QT_MAINNET_RELAYER_ADDRESS`, `QT_MAINNET_RELAYER_PRIVATE_KEY` (a dedicated low-balance relayer that only pays gas), `QT_IPO_RESOLVER_ECDSA_PRIVATE_KEY` and `QT_IPO_RESOLVER_MLDSA_SEED_HEX`. Its repository variables are `QTIMELINE_EVENT_ENABLED`, `QTIMELINE_EVENT_MARKET_ID`, `QT_EVENT_PERIOD`, `QT_EVENT_SOURCE`, `QT_BEA_DATA_PERIOD` and, for the SEC source, `QT_SEC_USER_AGENT`.

The schedule is a `cron` line (for the October 2026 Core PCE release: every 15 minutes, 13:00 to 18:59 UTC, 25 to 27 Nov). Scheduled runs broadcast. A manual run defaults to simulation and needs the explicit `broadcast` input. For a new event, change the variables and the `cron` line together, and run the workflow by hand once as a dry run.

For tests, `QT_EVENT_REHEARSAL_HTML` replaces the fetched release with a local file, and it is only honoured when the RPC is on localhost.

The sections below describe the runners of the original Core PCE system, which is not deployed on mainnet.


The resolver has isolated Robinhood Chain Testnet and Mainnet entry points. Both parse the official BEA Personal Income and Outlays article, sign the same EIP-712 report with ECDSA and ML-DSA-44, simulate before sending, and verify the final chain state.

## Mainnet runner

`pnpm --filter @qtimeline/resolver validate:mainnet-config` performs read-only chain, manifest, resolver, relayer, and registered ML-DSA-key checks. `pnpm --filter @qtimeline/resolver resolve:mainnet` defaults to simulation; set `QT_BROADCAST=1` only after the activated market, release schedule, deployer, relayer, and release gates are confirmed. An unpublished 404/410 is a no-op. The script requires a Mainnet manifest with sealed wiring, a market ID, and the matching BEA period; it refuses early, expired, wrong-period, or already-mismatched reports.

The Mainnet workflow is `.github/workflows/resolve-mainnet.yml`. It uses a separate `robinhood-mainnet` GitHub Environment and requires these secrets:

- `QT_MAINNET_RPC`
- `QT_MAINNET_RELAYER_ADDRESS`
- `QT_MAINNET_RELAYER_PRIVATE_KEY` (use a dedicated low-balance report relayer; it does not need admin privileges)
- `QT_MAINNET_RESOLVER_ECDSA_PRIVATE_KEY`
- `QT_MAINNET_RESOLVER_MLDSA_SEED_HEX` (the 32-byte `mainnet-bot-mldsa44.seed`, hex encoded)

After deployment, commit the public `deployments/robinhood-mainnet.json` manifest (it contains contract addresses and transaction evidence, not signer keys). After market activation, set `QTIMELINE_MAINNET_MANIFEST`, `QT_MAINNET_MARKET_ID`, `BEA_PERIOD_ID`, and `BEA_RELEASE_URL` in the `robinhood-mainnet` Environment. The scheduled job stays disabled until the repository variable `QTIMELINE_MAINNET_ENABLED=true`. A manual run defaults to simulation; its `broadcast` input must be explicitly enabled to submit. Do not put signer values in the repository, Vercel, or a public build. Keep an encrypted offline backup of `contracts/.secrets/` before registering keys.

The release workflow is configured for the October 2026 PIO article on November 25, 2026 at 13:30 UTC. If deployment or activation misses the release window, select a later BEA period and change the workflow schedule and environment variables together. Market activation still requires the audit, quote, gas, resolver, and hosting/legal release gates listed in docs/OPERATIONS.md.

## Testnet runner

The GitHub Actions workflow polls the official BEA Personal Income and Outlays article and reports Core PCE to Robinhood Chain Testnet (`46630`) only. It does not use Mainnet RPCs or Mainnet keys.

## GitHub Actions setup

The workflow uses the `robinhood-testnet` GitHub Environment. Store these as environment secrets (never commit their values):

- `QT_TESTNET_RPC`
- `QT_TESTNET_RELAYER_PRIVATE_KEY` (must match the testnet manifest deployer)
- `QT_TESTNET_RESOLVER_ECDSA_PRIVATE_KEY` (must match the testnet manifest resolver signer)
- `QT_TESTNET_RESOLVER_MLDSA_PRIVATE_KEY_PEM` (must match the registered bot ML-DSA key)

The `robinhood-testnet` Environment is configured for the October 2026 rehearsal:

- `QTIMELINE_TESTNET_MANIFEST`: `deployments/robinhood-testnet-bea-oct-2026.json` (activated testnet market, period `2026-10`).
- `BEA_PERIOD_ID`: `2026-10`.
- `BEA_RELEASE_URL`: `https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026`.

The scheduled job skips safely until all three variables are configured and the manifest file exists. It polls the October 2026 BEA release window on Nov 25–27, 2026 (UTC). Update the cron window and the three Environment variables together when selecting another release. Manual runs require all three values as workflow inputs.

## Safety and retry behavior

- Only `https://www.bea.gov` is accepted; an unpublished 404/410 is a successful no-op.
- The BEA title, period, Core PCE row, and printed monthly value must parse unambiguously.
- The RPC chain ID, ECDSA resolver, relayer, activated market period, deadline, and ML-DSA verifier are checked before submission.
- The action simulates the signed report, submits once, then verifies final status, value, and evidence hash from chain state.
- A repeated run against a terminal market is idempotent and submits no second report.
- A public evidence JSON artifact is retained for 90 days; it contains no private keys.

This release-specific workflow is a testnet rehearsal. Mainnet use requires a separately reviewed and deployed Mainnet resolver, keys, RPC, manifest, and workflow configuration.
