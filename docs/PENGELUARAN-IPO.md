# QTimeline IPO: Expense Report

As of 15 November 2026. Network: Robinhood Chain mainnet (4663). Event: Anthropic final IPO price, threshold $74.00.
Reference rate: ETH = $2,000 (the ETH amounts below change if the rate changes).

## Summary

| Type | Amount | Returned? |
|---|---|---|
| Contract deployment gas (already spent, 27 transactions) | 0.000953 ETH (about $1.9) | No |
| Upcoming gas (create market, bot report, liquidity exit) | about 0.00017 ETH (about $0.3) | No |
| Liquidity capital (seed) | 0.0265 ETH + 120 USDG (about $173) | Yes, can be withdrawn; the result can be higher or lower |

The only money that is actually spent is gas: about 0.0011 ETH (about $2.2) for the whole IPO system, of which 0.00095 ETH is already spent. The liquidity capital is not spent, but it is at risk (see Risks).

## 1. Already spent: ledger of the IPO mainnet deployment

All IPO contracts are deployed on mainnet (proxies, beacons, verifier, hook deployer, two ML-DSA key blobs) and wired together. The ledger below lists every transaction the deployer has sent on mainnet. The deployer nonce is 27 and the table has 27 rows, so nothing is missing. The relayer has sent nothing (nonce 0). The older Core PCE system was never deployed on mainnet.

- Transactions: 27
- Total gas: 47,322,984
- Cost: **0.000953 ETH** at about 0.02 gwei (about $1.9 at ETH $2,000)
- Source: on-chain receipts for the hashes in `deployments/robinhood-mainnet-ipo.json`
- Largest items: the two ML-DSA public key blobs (about 4.5 to 5.1 million gas each), the verifier, and the Keccak helper
- Timing (UTC): rows 1 to 21 on 14 November at 15:29 to 15:30, then the first run stopped because the deployer ran out of ETH. Rows 22 to 27 followed at 15:48 after a top-up.

| # | Time (UTC) | Item | Gas | Fee (ETH) | Tx |
|---|---|---|---|---|---|
| 1 | 2026-11-14 15:29 | F1600Helper | 4,856,543 | 0.000097 | `0x3658fa8a…330307` |
| 2 | 2026-11-14 15:29 | MLDSA44Verifier | 5,452,446 | 0.000109 | `0xc365da5c…3a7f80` |
| 3 | 2026-11-14 15:29 | IpoMarketRegistryImpl | 1,470,534 | 0.000030 | `0x7d4849f4…da650e` |
| 4 | 2026-11-14 15:29 | IpoPQKeyRegistryImpl | 1,169,365 | 0.000024 | `0x2323d10f…df866b` |
| 5 | 2026-11-14 15:29 | IpoMarketFactoryImpl | 3,318,373 | 0.000067 | `0xd6d5d5da…6b16f8` |
| 6 | 2026-11-14 15:29 | IpoResolutionAdapterImpl | 1,521,552 | 0.000031 | `0xa9cd1768…17a778` |
| 7 | 2026-11-14 15:29 | IpoTimelineRouterImpl | 4,500,168 | 0.000090 | `0x018fd5d6…2df300` |
| 8 | 2026-11-14 15:29 | IpoConditionalVaultImpl | 1,853,138 | 0.000038 | `0x97b6e70b…f08d02` |
| 9 | 2026-11-14 15:29 | IpoOutcomeTokenImpl | 1,363,454 | 0.000027 | `0x3072e92d…21dc13` |
| 10 | 2026-11-14 15:29 | IpoHookDeployer | 2,404,446 | 0.000048 | `0xbd6615ae…eb7daa` |
| 11 | 2026-11-14 15:29 | IpoTimelineHookImpl | 1,186,557 | 0.000024 | `0xce2e52e2…eeeddd` |
| 12 | 2026-11-14 15:29 | IpoOutcomeTokenBeacon | 341,917 | 0.000007 | `0x06999a42…6f17dc` |
| 13 | 2026-11-14 15:29 | IpoConditionalVaultBeacon | 341,971 | 0.000007 | `0xdbcc69c9…bc648a` |
| 14 | 2026-11-14 15:29 | IpoTimelineHookBeacon | 341,547 | 0.000007 | `0x3d599f7f…0d2ff8` |
| 15 | 2026-11-14 15:29 | IpoMarketRegistry | 854,635 | 0.000017 | `0x82a1efcc…6b962a` |
| 16 | 2026-11-14 15:29 | PQKeyRegistry | 856,208 | 0.000017 | `0x2ea0a66b…e4d00d` |
| 17 | 2026-11-14 15:29 | IpoMarketFactory | 1,030,371 | 0.000021 | `0xf10a3286…2564d7` |
| 18 | 2026-11-14 15:30 | IpoResolutionAdapter | 902,547 | 0.000018 | `0x4b88f383…fdb60c` |
| 19 | 2026-11-14 15:30 | TimelineRouter | 859,996 | 0.000017 | `0x56604600…e8aa66` |
| 20 | 2026-11-14 15:30 | deployerPKBlob | 5,075,715 | 0.000103 | `0xf597e49f…02ebeb` |
| 21 | 2026-11-14 15:30 | wiring: deployerKeyRegistered | 1,476,881 | 0.000030 | `0xec6a0c14…17f8ab` |
| 22 | 2026-11-14 15:48 | botPKBlob | 4,527,675 | 0.000091 | `0x3650ad78…c53e98` |
| 23 | 2026-11-14 15:48 | wiring: botKeyRegistered | 1,370,097 | 0.000027 | `0xf6341162…3b349e` |
| 24 | 2026-11-14 15:48 | wiring: pqKeyRegistrySealed | 36,883 | 0.000001 | `0xebbad516…839085` |
| 25 | 2026-11-14 15:48 | wiring: hookDeployerConfigured | 76,511 | 0.000002 | `0x1ca822ca…83bce8` |
| 26 | 2026-11-14 15:48 | wiring: factoryHookDeployerSet | 57,536 | 0.000001 | `0x17af0cdd…5dbc8c` |
| 27 | 2026-11-14 15:48 | wiring: registryWiredAndSealed | 75,918 | 0.000002 | `0x8a25d92e…c4a249` |
| | | **Total** | **47,322,984** | **0.000953** | |

### Balance reconciliation (deployer)

| Line | ETH |
|---|---|
| Funding received: first funding | 0.001078 |
| Funding received: top-up after the first run stopped (derived) | 0.001000 |
| Total received | 0.002078 |
| Spent on gas (ledger above) | -0.000953 |
| **Balance now** | **0.001125** |

The top-up is derived from the balance (received = balance + gas spent), not read from a transfer record. It comes out at 0.001 ETH.

Testnet transactions are not included: they cost test ETH with no value.

## 2. Funds requested

| Wallet | Address | ETH | USDG | Purpose |
|---|---|---|---|---|
| Deployer | `0x3B06A7c6839dF369d62961DcA54ea56185332828` | **0.035** | **120** | Liquidity seed and gas |
| Relayer (resolver bot) | address derived from `contracts/.secrets/mainnet-relayer.hex` | **0.001** | 0 | Gas for one result report |

Correction to an earlier figure: 0.03 ETH for the deployer is not enough. The market creation script requires a balance of at least the seed plus a 0.005 ETH safety margin, which is 0.0315 ETH. The deployer currently holds about 0.0011 ETH, so a 0.03 ETH top-up reaches only 0.0311. A top-up of **0.035 ETH** is safe.

Current balances (checked 14 November): deployer 0.0011 ETH and 0 USDG, relayer 0 ETH.

## 3. How the liquidity seed is calculated

Users trade against Uniswap v4 pools, so the pools must hold liquidity. Target: a $5 trade moves the price by at most 1% before fees. Fork simulation result: 0.97% to 0.99%.

ETH and USDG are first split into claims (1 ETH becomes 1 YES + 1 NO), then added to the pools.

| Pool | Contents | Value |
|---|---|---|
| ETH-YES | 0.0265 ETH-YES + 53 USDG-YES | about $106 |
| ETH-NO | 0.0265 ETH-NO + 53 USDG-NO | about $106 |
| Odds (YES/NO) | 67 USDG-YES + 67 USDG-NO | $134 |

- ETH to split: 53 / 2,000 = **0.0265 ETH**
- USDG to split: 53 + 67 = **120 USDG**
- Total: about $53 + $120 = **$173**
- A narrow price range (ETH minus 20% to plus 25%, odds 35% to 65%) makes a small amount of capital behave like deep liquidity.
- Less capital means more price impact. Half the capital gives about 2%.

Smaller seeds are possible (`QT_IPO_SEED_TIMELINE_USD`, `QT_IPO_SEED_PROBABILITY_USD`). Measured on a mainnet fork, price impact for a $5 trade scales roughly inversely with capital:

| Seed (timeline / odds, USD per side) | Capital | Impact of a $5 trade |
|---|---|---|
| 53 / 67 (default) | about $173 (0.0265 ETH + 120 USDG) | about 1% (0.97 to 0.99%) |
| 10 / 12 | about $32 (0.005 ETH + 22 USDG) | about 5% (5.0 to 5.3%) |

The smaller seed is enough to demo the full flow but quotes look expensive to real users.

If the ETH rate differs, USDG stays at 120 and the ETH amount changes:

| ETH/USD | ETH for the seed |
|---|---|
| 1,500 | 0.0353 |
| 2,000 | 0.0265 |
| 3,000 | 0.0177 |

## 4. Upcoming gas

Assumes a gas price of 0.02 gwei. Market creation and report gas come from the rehearsal on a mainnet fork.

| Step | Gas | ETH |
|---|---|---|
| Create market (createMarket) | 3.66M | 0.000073 |
| Initialize pools | 0.24M | 0.000005 |
| Mint 3 LP positions | 1.45M | 0.000029 |
| Activate market | 0.09M | 0.000002 |
| Result report by the bot | 1.41M | 0.000028 |
| Liquidity exit and redeem (estimate, not yet measured on mainnet) | about 1.5M | about 0.00003 |
| **Total** | about 8.4M | **about 0.00017** |

The 0.001 ETH reserve on the relayer and the leftover on the deployer are enough to retry failed transactions.

## 5. Other costs (not yet calculated)

- Site hosting (Vercel): the plan in use is unknown to me.
- RPC provider (Alchemy): plan unknown. The public browser RPC is not yet verified.
- GitHub Actions for the resolver bot: runs every 15 minutes during 19 to 21 November. Cost depends on the account plan.
- Independent audit: none, only our own review.
- Domain: none.

## 6. Risks to the capital

- The liquidity capital is not a sunk cost, but it can shrink. If one side of the IPO outcome ends up worth zero, part of the USDG in that pool can be lost. The 0.30% fee also accrues to the position.
- Liquidity can be withdrawn at any time (the hook does not block withdrawals). Withdrawing while the market is open removes the counterparty for every trader.
- The IPO system is upgradeable: the deployer can replace contract logic. This is a trust assumption on a single key.
- Exit path: `pnpm withdraw:ipo` (plan) and `-- --broadcast` (execute). Verified on a fork after a Final YES result; the merge path before a result has not been tested.
- Deadline: the market must be active before 18 November 2026 00:00 UTC.
