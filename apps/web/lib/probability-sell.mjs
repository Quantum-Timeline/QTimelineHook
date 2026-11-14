export async function findBestProbabilitySell(totalAmount, quoteExactInput) {
  if (totalAmount < 2n) throw new RangeError("Sell amount must contain at least two token units.");

  const quotes = new Map();
  const quote = async (amount) => {
    if (quotes.has(amount)) return quotes.get(amount);
    const result = await quoteExactInput(amount);
    if (result !== undefined && result !== null && result <= 0n) return undefined;
    quotes.set(amount, result ?? undefined);
    return result ?? undefined;
  };

  const lastInput = totalAmount - 1n;
  let firstFill = 1n;
  if ((await quote(firstFill)) === undefined) {
    if ((await quote(lastInput)) === undefined) throw new Error("Pool has no fully quotable probability sell input.");
    let invalid = firstFill;
    let valid = lastInput;
    while (valid - invalid > 1n) {
      const middle = (valid + invalid) / 2n;
      if ((await quote(middle)) === undefined) invalid = middle;
      else valid = middle;
    }
    firstFill = valid;
  }

  let maxFill = lastInput;
  if ((await quote(maxFill)) === undefined) {
    let valid = firstFill;
    let invalid = maxFill;
    while (invalid - valid > 1n) {
      const middle = (valid + invalid) / 2n;
      if ((await quote(middle)) === undefined) invalid = middle;
      else valid = middle;
    }
    maxFill = valid;
  }

  let left = firstFill;
  let right = maxFill;
  while (left < right) {
    const middle = (left + right) / 2n;
    const output = await quote(middle);
    if (output === undefined) {
      left = middle + 1n;
      continue;
    }
    if (output >= totalAmount - middle) right = middle;
    else left = middle + 1n;
  }

  const candidates = new Set([firstFill, maxFill, left, left - 1n, left + 1n, left + 2n]);
  let best;
  for (const amount of candidates) {
    if (amount < firstFill || amount > maxFill) continue;
    const swapOut = await quote(amount);
    if (swapOut === undefined) continue;
    const collateralOut = totalAmount - amount < swapOut ? totalAmount - amount : swapOut;
    if (!best || collateralOut > best.collateralOut || (collateralOut === best.collateralOut && amount < best.swapAmount)) {
      best = { swapAmount: amount, swapOut, collateralOut };
    }
  }

  if (!best || best.collateralOut === 0n) throw new Error("Pool cannot provide a nonzero merged sell payout.");
  return best;
}
