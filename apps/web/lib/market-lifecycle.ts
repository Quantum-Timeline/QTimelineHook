export type MarketTradeWindow = {
  status: number;
  activated: boolean;
  opensAt: bigint;
  cutoffAt: bigint;
  chainTimestamp: bigint;
};

export function canTradeAt(market: MarketTradeWindow): boolean {
  const statusAllowsTrading = market.status === 1 || market.status === 2;
  return market.activated && statusAllowsTrading && market.chainTimestamp >= market.opensAt && market.chainTimestamp < market.cutoffAt;
}
