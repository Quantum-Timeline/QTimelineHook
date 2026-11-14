# BEA resolver bot

The GitHub Actions workflow polls the official BEA Personal Income and Outlays article and can report Core PCE to **Robinhood Chain Testnet (46630) only**. It does not use Mainnet RPCs or Mainnet keys.

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
