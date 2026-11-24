/** Markets that have ended. Static on purpose: an ended market never changes, and the site is a static export. */
export type PastMarket = {
  event: "ipo" | "pce";
  question: string;
  status: "Cancelled" | "Settled YES" | "Settled NO";
  /** One plain sentence on how it ended and what holders can do. */
  outcome: string;
  /** Trading and report window, already formatted for display (UTC). */
  window: string;
  marketId: string;
  /** Vault address, linked to the explorer so anyone can verify the market on chain. */
  vault: string;
};

const EXPLORER = "https://robinhoodchain.blockscout.com/address/";

export const PAST_MARKETS: PastMarket[] = [
  {
    event: "ipo",
    question: "Will Anthropic's final IPO price be at or above $74.00 per share?",
    status: "Cancelled",
    outcome: "No result was reported before the 21 Nov deadline, so the market was cancelled and every claim redeems at 50 cents. Redeem from the Positions page.",
    window: "Trading closed 18 Nov 12:00 UTC · report window ended 21 Nov 06:00 UTC",
    marketId: "0x19d1b881668c8c8c776c92c1745daf74933b2c40c82065ba5f6017ee5e6aeafa",
    vault: "0x7ACf9Dca7a456175ed66bbec8b8600c9fe6e5c0d",
  },
];

export const explorerAddress = (address: string) => `${EXPLORER}${address}`;
