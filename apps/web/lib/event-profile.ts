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
  /** Which event this build shows. A "pce" event with id "ipo" is the macro event on the shared engine, not the legacy Core system. */
  event: "ipo" | "pce";
  metaTitle: string;
  metaDescription: string;
  /** Link-preview artwork for events that do not use the default banners. */
  banner?: { url: string; width: number; height: number; alt: string };
  /** Line drawn under the quick-bet card, in display units formatted by `format`. */
  ruler?: { min: number; max: number; threshold: number; format(n: number): string };
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
    lockLead: "TimelineHook enforces the 13:25 UTC pre-release lock directly inside beforeSwap across ETH-YES, ETH-NO, and YES/NO, eliminating toxic release-second front-running.",
    oracleCard: "Dual ECDSA + NIST FIPS 204 module-lattice attestation verifies BEA Core PCE finality on-chain.",
    ethYes: "Conditional ETH price discovery if BEA Core PCE Oct 2026 prints ≥ 0.30% MoM.",
    ethNo: "Parallel ETH price discovery if BEA Core PCE Oct 2026 prints < 0.30% MoM.",
    traderCard: "Express joint views on US Core PCE inflation and ETH price without liquidation risk.",
    sourceKey: "BEA",
    sourceTitle: "Zero revision ambiguity",
    sourceText: "Resolves strictly from the first-release BEA Personal Income and Outlays MoM Core PCE table, never revised prints.",
    expiryText: "If the oracle stalls past 27 Nov 13:30 UTC, any address can call cancelExpired(marketId) for 50/50 redemption.",
    benchmark: "BEA Core PCE Oct 2026 (MoM) ≥ 0.30%: first-release table, scheduled 25 Nov 13:30 UTC.",
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
  event: "pce",
  metaTitle: "QTimeline: Every pool, two timelines",
  metaDescription: "Split USDG into YES/NO claims, trade conditional ETH discovery across three Uniswap v4 pools, and settle under ECDSA + ML-DSA-44 on Robinhood Chain.",
};

const thresholdDollars = process.env.NEXT_PUBLIC_IPO_THRESHOLD;
const ipoThreshold = Number(thresholdDollars) || 74;

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
    sourceText: "Resolves strictly from the offering price printed in the first Form 424B4 filed on SEC EDGAR, and later filings never change it.",
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
    oracleTitle: "SEC filing, hybrid authorization",
    guardLabel: "On-chain beforeSwap guard halts all three pools at the cutoff, before the offering is priced.",
    marketBlurb: "Pick a side. If you are right, each share pays $1.00 once the SEC publishes the final price. If not, it pays $0.",
    metaLabel: "Anthropic IPO · Form 424B4",
    condYes: `Final price ≥ ${dollars(ipoThreshold * 100)}`,
    condNo: `Final price < ${dollars(ipoThreshold * 100)}`,
    swapText: "Swap across ETH-YES, ETH-NO, and YES/NO on Uniswap v4 to trade your view on the IPO price together with ETH.",
    traders: "IPO Traders",
    kicker: "First Filing",
    audience: "Conditional markets for IPO traders",
    launchLabel: "Anthropic IPO market",
    footerBlurb: "Conditional markets on Uniswap v4. Trade the Anthropic IPO price, settled from the SEC filing.",
    filingUnit: "FILING",
    filingCaption: "Only the first Form 424B4 on SEC EDGAR settles the market",
    waitDone: "Waiting for the Form 424B4",
  },
  formatThreshold: dollars,
  formatValue: dollars,
  event: "ipo",
  metaTitle: "QTimeline: Anthropic IPO price market",
  metaDescription: `${thresholdDollars ? `Will Anthropic's final IPO price be at or above $${Number(thresholdDollars).toFixed(2)} per share?` : "Will Anthropic's final IPO price be at or above the market threshold?"} Buy YES or NO on Robinhood Chain. Each winning share pays $1.00, settled from the SEC's Form 424B4.`,
  ruler: { min: 50, max: 110, threshold: ipoThreshold, format: (n) => `$${n.toFixed(2)}` },
};

// Macro event (US Core PCE) on the shared engine. Everything event-specific comes from build variables, so the next release only
// needs new values for NEXT_PUBLIC_EVENT_THRESHOLD_BPS, NEXT_PUBLIC_EVENT_PERIOD_LABEL and NEXT_PUBLIC_EVENT_CUTOFF_AT, not a new contract deployment.
const eventBps = Number(process.env.NEXT_PUBLIC_EVENT_THRESHOLD_BPS ?? "30");
const periodLabel = process.env.NEXT_PUBLIC_EVENT_PERIOD_LABEL ?? "October 2026";
const eventCutoffAt = Number(process.env.NEXT_PUBLIC_EVENT_CUTOFF_AT) || undefined;
const pctText = percent(eventBps);
const releaseDate = eventCutoffAt
  ? new Date((eventCutoffAt + 300) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  : undefined;
const pceQuestion = `Will US Core PCE rise at least ${pctText} month over month in ${periodLabel}?`;

const pceEngine: EventProfile = {
  id: "ipo",
  event: "pce",
  tag: `Core PCE · ${periodLabel}`,
  question: pceQuestion,
  yesLabel: `YES · ≥ ${pctText}`,
  noLabel: `NO · < ${pctText}`,
  source: `First BEA Personal Income and Outlays release for ${periodLabel}, Core PCE price index, percent change from the preceding month`,
  thresholdLabel: "Threshold",
  reportedLabel: "Reported Core PCE",
  oracleRule: "A project bot reads the first official BEA release and reports the printed month-over-month Core PCE in basis points. The report digest requires both ECDSA and ML-DSA-44 signatures. These keys share project control; the signature does not independently prove the BEA number. The release and its hash are public.",
  cutoffNumber: ["5 min", "Cutoff before release", "Swaps close on-chain"],
  cutoffAt: eventCutoffAt,
  copy: {
    heroEyebrow: "Prediction market on Robinhood Chain",
    heroA: "Bet on inflation,",
    heroB: "before it prints.",
    heroLead: `Core PCE is the Fed's preferred inflation gauge, and the BEA publishes the ${periodLabel} number${releaseDate ? ` on ${releaseDate}` : ""}. Buy YES if it prints ${pctText} or higher, NO if lower. A winning share pays $1.00 in USDG, all on-chain with no account needed.`,
    heroCta: "Trade YES or NO",
    heroCtaAlt: "How it works",
    heroStep1: "Pick YES or NO",
    heroStep2: "BEA publishes the number",
    heroStep3: "Winners get $1.00 a share",
    relEyebrow: "How it ends",
    relTitle: "One number decides everything",
    relLead: "No judges and no appeals. The BEA publishes the Core PCE figure once, a signed report puts it on-chain, and the market pays out from it.",
    relStep1: "Trading closes",
    relStep1Text: "The hook locks all three pools on-chain five minutes before the release, so nobody trades once the number is out.",
    relStep2: "The BEA publishes the number",
    relStep2Text: `The first release for ${periodLabel} is the only one that counts. Later revisions are ignored.`,
    relStep3: "The result goes on-chain",
    relStep3Text: "A bot reports the figure with two signatures, ECDSA and ML-DSA-44. The vault checks both before the market resolves.",
    relStep4: "Winners redeem",
    relStep4Text: "Each winning share redeems for $1.00 in USDG from the Positions page.",
    relYes: `Prints ${pctText} or higher`,
    relNo: `Prints below ${pctText}`,
    manifesto: "We split one macroeconomic print into two live Uniswap v4 timelines on Robinhood Chain. Trade conditional ETH exposure and settle from the first BEA release under hybrid ECDSA plus NIST FIPS 204 post-quantum signatures.",
    lockCaption: "Swap lock before the BEA release",
    lockKicker: "Cutoff",
    lockText: "TimelineHook enforces beforeSwap on every pool, locking swaps at the on-chain cutoff before the BEA release.",
    lockLead: "TimelineHook enforces the cutoff directly inside beforeSwap across ETH-YES, ETH-NO, and YES/NO, so nobody trades after the number is known.",
    oracleCard: "Dual ECDSA + NIST FIPS 204 module-lattice attestation settles the BEA-reported Core PCE on-chain.",
    ethYes: `Conditional ETH price discovery if Core PCE prints at or above ${pctText} month over month.`,
    ethNo: `Parallel ETH price discovery if Core PCE prints below ${pctText} month over month.`,
    traderCard: "Express joint views on US inflation and ETH price without liquidation risk.",
    sourceKey: "BEA",
    sourceTitle: "First release only",
    sourceText: "Resolves strictly from the first BEA Personal Income and Outlays release, and later revisions never change it.",
    expiryText: "If no BEA figure is reported before the on-chain deadline, any address can call cancelExpired(marketId) for 50/50 redemption.",
    benchmark: `US Core PCE ${periodLabel}, month over month, read from the first BEA release.`,
    lockQuote: "ETH-YES, ETH-NO, and YES/NO pools locked at the cutoff by TimelineHook.",
    attestQuote: "Dual ECDSA + NIST FIPS 204 ML-DSA-44 attestation, or 50/50 expiry after the deadline.",
    enforced: "Fees, beta caps, the resolution source, and the expiry fallback are encoded in the contracts. The deployer can upgrade contract logic.",
    footer: `Core PCE ${periodLabel}`,
    menuLock: "Cutoff before release",
    genesis: `US Core PCE ${periodLabel} (at or above ${pctText} month over month), taken from the first BEA release. Trading halts on-chain at the cutoff, before the release.`,
    releaseHeadline: "BEA release in",
    voteNext: "Pick one of two fixed thresholds for the next event. Each wallet votes a single time.",
    oracleTitle: "BEA release, hybrid authorization",
    guardLabel: "On-chain beforeSwap guard halts all three pools at the cutoff, before the number is released.",
    marketBlurb: "Pick a side. If you are right, each share pays $1.00 once BEA publishes the Core PCE figure. If not, it pays $0.",
    metaLabel: "US Core PCE · BEA first release",
    condYes: `Core PCE ≥ ${pctText}`,
    condNo: `Core PCE < ${pctText}`,
    swapText: "Swap across ETH-YES, ETH-NO, and YES/NO on Uniswap v4 to trade your view on US inflation together with ETH.",
    traders: "Macro Traders",
    kicker: "First Release",
    audience: "Conditional markets for macro traders",
    launchLabel: `Core PCE ${periodLabel}`,
    footerBlurb: "Conditional markets on Uniswap v4. Trade US Core PCE, settled from the BEA release.",
    filingUnit: "RELEASE",
    filingCaption: "Only the first BEA release settles the market",
    waitDone: "Waiting for the BEA release",
  },
  formatThreshold: percent,
  formatValue: percent,
  metaTitle: "QTimeline: US Core PCE market",
  metaDescription: `${pceQuestion} Buy YES or NO on Robinhood Chain. Each winning share pays $1.00, settled from the first BEA release.`,
  ruler: { min: 0, max: Math.max(60, Math.abs(eventBps) * 2), threshold: eventBps, format: percent },
};

// US unemployment rate (BLS Employment Situation) on the same shared engine. It reuses the macro profile and only changes what is
// specific to the data: the one-decimal rate, the BLS source, and the wording. Threshold 420 means 4.2%.
const rate = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const rateText = rate(eventBps);
const jobsQuestion = `Will the US unemployment rate be ${rateText} or higher in ${periodLabel}?`;

const jobsEngine: EventProfile = {
  ...pceEngine,
  tag: `Unemployment rate · ${periodLabel}`,
  question: jobsQuestion,
  yesLabel: `YES · ≥ ${rateText}`,
  noLabel: `NO · < ${rateText}`,
  source: `First BLS Employment Situation release for ${periodLabel}, unemployment rate, total, seasonally adjusted (Table A-1)`,
  reportedLabel: "Reported unemployment rate",
  oracleRule: "A project bot reads the first official BLS Employment Situation release and reports the printed unemployment rate in basis points (4.2% is 420). The report digest requires both ECDSA and ML-DSA-44 signatures. These keys share project control; the signature does not independently prove the BLS number. The release and its hash are public.",
  copy: {
    ...pceEngine.copy,
    heroA: "Bet on jobs,",
    heroB: "before the report.",
    heroLead: `The unemployment rate is the headline number in the monthly US jobs report, and the BLS publishes the ${periodLabel} figure${releaseDate ? ` on ${releaseDate}` : ""}. Buy YES if it prints ${rateText} or higher, NO if lower. A winning share pays $1.00 in USDG, all on-chain with no account needed.`,
    heroStep2: "BLS publishes the number",
    relLead: "No judges and no appeals. The BLS publishes the unemployment rate once, a signed report puts it on-chain, and the market pays out from it.",
    relStep2: "The BLS publishes the number",
    relStep2Text: `The first release for ${periodLabel} is the only one that counts. Later revisions are ignored.`,
    relYes: `Prints ${rateText} or higher`,
    relNo: `Prints below ${rateText}`,
    manifesto: "We split one labor-market print into two live Uniswap v4 timelines on Robinhood Chain. Trade conditional ETH exposure and settle from the first BLS release under hybrid ECDSA plus NIST FIPS 204 post-quantum signatures.",
    lockCaption: "Swap lock before the BLS release",
    lockText: "TimelineHook enforces beforeSwap on every pool, locking swaps at the on-chain cutoff before the BLS release.",
    lockLead: "TimelineHook enforces the cutoff directly inside beforeSwap across ETH-YES, ETH-NO, and YES/NO, so nobody trades after the number is known.",
    oracleCard: "Dual ECDSA + NIST FIPS 204 module-lattice attestation settles the BLS-reported unemployment rate on-chain.",
    ethYes: `Conditional ETH price discovery if unemployment prints at or above ${rateText}.`,
    ethNo: `Parallel ETH price discovery if unemployment prints below ${rateText}.`,
    traderCard: "Express joint views on the US labor market and ETH price without liquidation risk.",
    sourceKey: "BLS",
    sourceTitle: "First release only",
    sourceText: "Resolves strictly from the first BLS Employment Situation release, and later revisions never change it.",
    expiryText: "If no BLS figure is reported before the on-chain deadline, any address can call cancelExpired(marketId) for 50/50 redemption.",
    benchmark: `US unemployment rate ${periodLabel}, seasonally adjusted, read from the first BLS release.`,
    footer: `Unemployment ${periodLabel}`,
    genesis: `US unemployment rate ${periodLabel} (at or above ${rateText}), taken from the first BLS release. Trading halts on-chain at the cutoff, before the release.`,
    releaseHeadline: "BLS release in",
    oracleTitle: "BLS release, hybrid authorization",
    guardLabel: "On-chain beforeSwap guard halts all three pools at the cutoff, before the number is released.",
    marketBlurb: "Pick a side. If you are right, each share pays $1.00 once BLS publishes the unemployment rate. If not, it pays $0.",
    metaLabel: "US unemployment rate · BLS first release",
    condYes: `Unemployment ≥ ${rateText}`,
    condNo: `Unemployment < ${rateText}`,
    swapText: "Swap across ETH-YES, ETH-NO, and YES/NO on Uniswap v4 to trade your view on US jobs together with ETH.",
    launchLabel: `Unemployment ${periodLabel}`,
    footerBlurb: "Conditional markets on Uniswap v4. Trade the US unemployment rate, settled from the BLS release.",
    filingCaption: "Only the first BLS release settles the market",
    waitDone: "Waiting for the BLS release",
  },
  formatThreshold: rate,
  formatValue: rate,
  metaTitle: "QTimeline: US unemployment rate market",
  metaDescription: `${jobsQuestion} Buy YES or NO on Robinhood Chain. Each winning share pays $1.00, settled from the first BLS release.`,
  banner: { url: "/brand/og-jobs.png", width: 1200, height: 630, alt: "QTimeline: Bet on jobs, before the report" },
  ruler: { min: Math.max(0, eventBps - 100), max: eventBps + 100, threshold: eventBps, format: rate },
};

export const eventProfile: EventProfile = process.env.NEXT_PUBLIC_EVENT_PROFILE === "pce" ? pce : process.env.NEXT_PUBLIC_EVENT_KIND === "pce" ? pceEngine : process.env.NEXT_PUBLIC_EVENT_KIND === "unemployment" ? jobsEngine : ipo;
