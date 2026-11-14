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
  formatThreshold: dollars,
  formatValue: dollars,
};

export const eventProfile: EventProfile = process.env.NEXT_PUBLIC_EVENT_PROFILE === "ipo" ? ipo : pce;
