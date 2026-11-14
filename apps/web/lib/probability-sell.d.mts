export type ProbabilitySellPlan = {
  swapAmount: bigint;
  swapOut: bigint;
  collateralOut: bigint;
};

export function findBestProbabilitySell(
  totalAmount: bigint,
  quoteExactInput: (amount: bigint) => Promise<bigint | undefined>,
): Promise<ProbabilitySellPlan>;
