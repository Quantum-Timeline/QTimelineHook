/** Copy and number formats for the event a deployment resolves. One static build serves exactly one profile. */
export type EventProfileId = "pce" | "ipo";

export type EventProfile = {
  id: EventProfileId;
  tag: string;
  question: string;
  yesLabel: string;
  noLabel: string;
  source: string;
  thresholdLabel: string;
  reportedLabel: string;
  oracleRule: string;
  cutoffNumber: [string, string, string];
  /** Unix seconds when swaps stop; drives the landing countdown. */
  cutoffAt?: number;
  copy: Record<string, string>;
  formatThreshold(thresholdBps: number): string;
  formatValue(valueBps: number): string;
};

const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pce: EventProfile = {
  id: "pce",
  tag: "Core PCE · October 2026",
  question: "Did US Core PCE rise at least 0.3% month over month?",
  yesLabel: "YES · PCE ≥ 0.30%",
  noLabel: "NO · PCE < 0.30%",
  source: "First BEA Personal Income and Outlays release for October 2026",
  thresholdLabel: "Threshold",
  reportedLabel: "Reported value",
  oracleRule: "A project bot reads the first official BEA release. The report digest requires both ECDSA and ML-DSA-44 signatures. These keys share project control; the signature does not independently prove the BEA number.",
  cutoffNumber: ["5 min", "Cutoff before release", "Swaps close on-chain"],
  copy: {
    heroEyebrow: "Core PCE Oct 2026",
    heroA: "One macro event",
    heroB: "two timelines",
    heroLead: "BEA Core PCE ≥ 0.30% MoM. Split USDG into YES/NO claims, trade conditional ETH discovery on Uniswap v4, and settle under ECDSA + ML-DSA-44.",
    manifesto: "We split one macroeconomic trigger into two live Uniswap v4 timelines on Robinhood Chain. Trade conditional ETH exposure and settle under hybrid ECDSA plus NIST FIPS 204 post-quantum proofs.",
    lockCaption: "Pre-release swap lock at 13:25 UTC",
    lockKicker: "13:25 UTC",
    lockText: "TimelineHook enforces beforeSwap on every pool, locking swaps 5 minutes before the 13:30 UTC BEA Core PCE release.",
    lockLead: "TimelineHook enforces the 13:25 UTC pre-release lock directly inside beforeSwap across ETH-YES, ETH-NO, and YES/NO—eliminating toxic release-second front-running.",
    oracleCard: "Dual ECDSA + NIST FIPS 204 module-lattice attestation verifies BEA Core PCE finality on-chain.",
    ethYes: "Conditional ETH price discovery if BEA Core PCE Oct 2026 prints ≥ 0.30% MoM.",
    ethNo: "Parallel ETH price discovery if BEA Core PCE Oct 2026 prints < 0.30% MoM.",
    traderCard: "Express joint views on US Core PCE inflation and ETH price without liquidation risk.",
    sourceKey: "BEA",
    sourceTitle: "Zero revision ambiguity",
    sourceText: "Resolves strictly from the first-release BEA Personal Income and Outlays MoM Core PCE table—never revised prints.",
    expiryText: "If the oracle stalls past 27 Nov 13:30 UTC, any address can call cancelExpired(marketId) for 50/50 redemption.",
    benchmark: "BEA Core PCE Oct 2026 (MoM) ≥ 0.30% — first-release table, scheduled 25 Nov 13:30 UTC.",
    lockQuote: "ETH-YES, ETH-NO, and YES/NO pools (~$173 seed model) locked at 13:25 UTC by TimelineHook.",
    attestQuote: "Dual ECDSA + NIST FIPS 204 ML-DSA-44 attestation, or 50/50 expiry after 27 Nov 13:30 UTC.",
    enforced: "Every fee, beta cap, release source, and 48-hour expiry fallback is encoded in immutable smart contracts.",
    footer: "Core PCE Oct 2026",
    menuLock: "13:25 UTC Hard Cutoff",
    genesis: "BEA Core PCE · October 2026 (≥ 0.30% MoM). Trading halts automatically at 13:25 UTC, 5 minutes before the 13:30 UTC release.",
    releaseHeadline: "BEA release in",
    voteNext: "Pick one of two fixed thresholds for the next Core PCE release. Each wallet votes a single time.",
  },
  formatThreshold: percent,
  formatValue: percent,
};

const thresholdDollars = process.env.NEXT_PUBLIC_IPO_THRESHOLD;

const ipo: EventProfile = {
  id: "ipo",
  tag: "Anthropic IPO · final offer price",
  question: thresholdDollars
    ? `Will Anthropic's final IPO price be at or above $${Number(thresholdDollars).toFixed(2)} per share?`
    : "Will Anthropic's final IPO price be at or above the market threshold?",
  yesLabel: thresholdDollars ? `YES · ≥ $${Number(thresholdDollars).toFixed(2)}` : "YES · at or above",
  noLabel: thresholdDollars ? `NO · < $${Number(thresholdDollars).toFixed(2)}` : "NO · below",
  source: "Initial public offering price per share in the final prospectus (Form 424B4) filed with the SEC by Anthropic, PBC (Class A, Nasdaq: ANT)",
  thresholdLabel: "Threshold price",
  reportedLabel: "Final offer price",
  oracleRule: "A project bot reads the final prospectus (Form 424B4) on SEC EDGAR and reports the printed offering price in cents. The report digest requires both ECDSA and ML-DSA-44 signatures. These keys share project control; the signature does not independently prove the SEC number. The filing and its hash are public.",
  cutoffNumber: ["Before pricing", "Trading stops", "Swaps close on-chain before the offering is priced"],
  cutoffAt: 1795003200,
  copy: {
    heroEyebrow: "Anthropic IPO price",
    heroA: "One IPO price",
    heroB: "two timelines",
    heroLead: thresholdDollars
      ? `Will Anthropic's final IPO price be at or above $${Number(thresholdDollars).toFixed(2)}? Buy YES or NO shares. Each winning share pays $1.00 once the SEC's final prospectus is out, settled on Uniswap v4 under ECDSA + ML-⁠DSA-⁠44.`
      : "Will Anthropic's final IPO price clear the threshold? Buy YES or NO shares. Each winning share pays $1.00 once the SEC's final prospectus is out.",
    manifesto: "We split one IPO pricing question into two live Uniswap v4 timelines on Robinhood Chain. Trade conditional ETH exposure and settle from the SEC Form 424B4 under hybrid ECDSA plus NIST FIPS 204 post-quantum signatures.",
    lockCaption: "Swap lock before the offering is priced",
    lockKicker: "Cutoff",
    lockText: "IpoTimelineHook enforces beforeSwap on every pool, locking swaps at the on-chain cutoff before the offering is priced.",
    lockLead: "IpoTimelineHook enforces the cutoff directly inside beforeSwap across ETH-YES, ETH-NO, and YES/NO, so nobody trades after the price is known.",
    oracleCard: "Dual ECDSA + NIST FIPS 204 module-lattice attestation settles the SEC-reported offering price on-chain.",
    ethYes: "Conditional ETH price discovery if Anthropic's final IPO price is at or above the threshold.",
    ethNo: "Parallel ETH price discovery if Anthropic's final IPO price is below the threshold.",
    traderCard: "Express joint views on the Anthropic IPO price and ETH price without liquidation risk.",
    sourceKey: "SEC",
    sourceTitle: "First filing only",
    sourceText: "Resolves strictly from the offering price printed in the first Form 424B4 filed on SEC EDGAR—later filings never change it.",
    expiryText: "If no 424B4 is reported before the on-chain deadline, any address can call cancelExpired(marketId) for 50/50 redemption.",
    benchmark: "Anthropic final IPO price per share, read from the first Form 424B4 on SEC EDGAR.",
    lockQuote: "ETH-YES, ETH-NO, and YES/NO pools locked at the cutoff by IpoTimelineHook.",
    attestQuote: "Dual ECDSA + NIST FIPS 204 ML-DSA-44 attestation, or 50/50 expiry after the deadline.",
    enforced: "Fees, beta caps, the resolution source, and the 48-hour expiry fallback are encoded in the contracts. The deployer can upgrade contract logic.",
    footer: "Anthropic IPO price",
    menuLock: "Cutoff before pricing",
    genesis: "Anthropic, PBC final IPO price per share, taken from the first Form 424B4 on SEC EDGAR. Trading halts on-chain at the cutoff, before the offering is priced.",
    releaseHeadline: "Filing expected in",
    voteNext: "Pick one of two fixed thresholds for the next event. Each wallet votes a single time.",
  },
  formatThreshold: dollars,
  formatValue: dollars,
};

export const eventProfile: EventProfile = process.env.NEXT_PUBLIC_EVENT_PROFILE === "pce" ? pce : ipo;
