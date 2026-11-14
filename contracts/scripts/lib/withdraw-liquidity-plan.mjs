const ACTION_DECREASE_LIQUIDITY = "01";
const ACTION_TAKE_PAIR = "11";

export function buildWithdrawalPlan(positions, recipient) {
  if (!Array.isArray(positions) || positions.length === 0) throw new Error("at least one LP position is required");
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("invalid withdrawal recipient");

  const actions = [];
  const params = [];
  const takeRecipients = [];
  for (const position of positions) {
    const tokenId = BigInt(position.tokenId);
    const liquidity = BigInt(position.liquidity);
    if (liquidity <= 0n) throw new Error("positions must have positive liquidity");
    if (!position.key || !/^0x[0-9a-fA-F]{40}$/.test(position.key.currency0) || !/^0x[0-9a-fA-F]{40}$/.test(position.key.currency1)) {
      throw new Error("position pool key must contain two valid currencies");
    }
    actions.push(ACTION_DECREASE_LIQUIDITY, ACTION_TAKE_PAIR);
    params.push({ type: "decrease", tokenId, liquidity, key: position.key });
    params.push({ type: "takePair", key: position.key });
    takeRecipients.push(recipient);
  }
  return { actions: `0x${actions.join("")}`, params, positions: positions.length, takeRecipients };
}
