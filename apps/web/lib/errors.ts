/** Turns wallet and contract errors into one short sentence a visitor can act on. */
export function friendlyError(error: unknown, fallback: string): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  const code = (error as { code?: number; cause?: { code?: number } } | undefined)?.code ?? (error as { cause?: { code?: number } } | undefined)?.cause?.code;
  if (code === 4001 || /user rejected|rejected the request|denied transaction|user denied/i.test(text)) return "You cancelled the request in your wallet. Nothing was sent.";
  if (/insufficient funds|exceeds the balance|gas required exceeds/i.test(text)) return "Not enough ETH to pay network fees. Add a little ETH and try again.";
  if (/Slippage|min.*out|amountOut/i.test(text)) return "The price moved while you were confirming. Refresh the quote and try again.";
  if (/MarketNotTradable|not open|InvalidState/i.test(text)) return "Trading is closed for this market.";
  if (/Expired|deadline/i.test(text)) return "The quote expired. Try again.";
  if (/InvalidNonce/i.test(text)) return "Another transaction from this wallet is still pending. Wait a moment and try again.";
  if (/transfer amount exceeds|ERC20: transfer|insufficient allowance|balance/i.test(text)) return "Your token balance is too low for this amount.";
  if (/network|fetch|timeout|HTTP request failed|Failed to fetch/i.test(text)) return "Could not reach the network. Check your connection and try again.";
  if (error instanceof Error && error.message && error.message.length <= 140 && !/\n/.test(error.message)) return error.message;
  return fallback;
}
