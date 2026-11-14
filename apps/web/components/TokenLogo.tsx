/* Token marks for the product UI. ETH and USDG use the real asset art; YES / NO are drawn badges. */
type Asset = "ETH" | "USDG";

const SRC: Record<Asset, string> = { ETH: "/tokens/eth.png", USDG: "/tokens/usdg.png" };

export function TokenLogo({ asset, size = 28 }: { asset: Asset; size?: number }) {
  return (
    <span className="tlogo" style={{ width: size, height: size }} title={asset} aria-hidden="true">
      <img src={SRC[asset]} alt="" width={size} height={size} decoding="async" />
    </span>
  );
}

export function OutcomeBadge({ yes, size = 16 }: { yes: boolean; size?: number }) {
  return (
    <span className={`obadge obadge--${yes ? "yes" : "no"}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 16 16">{yes ? <path d="M4 8.5l2.8 2.8L12 5.5" /> : <path d="M5 5l6 6M11 5l-6 6" />}</svg>
    </span>
  );
}

/** A claim token: the asset mark with a small YES / NO badge pinned to its corner. */
export function ClaimIcon({ asset, yes, size = 34 }: { asset: Asset; yes: boolean; size?: number }) {
  return (
    <span className="claimicon" style={{ width: size, height: size }} aria-hidden="true">
      <TokenLogo asset={asset} size={size} />
      <OutcomeBadge yes={yes} size={Math.round(size * 0.46)} />
    </span>
  );
}

/** Two overlapping marks, e.g. the ETH / USDG pair. */
export function TokenPair({ a, b, size = 30 }: { a: Asset; b: Asset; size?: number }) {
  return (
    <span className="tpair" role="img" aria-label={`${a} and ${b}`}>
      <TokenLogo asset={a} size={size} />
      <TokenLogo asset={b} size={size} />
    </span>
  );
}

/** Pair of claim tokens that make up one pool. */
export function PoolPair({ a, b, yesA, yesB, size = 34 }: { a: Asset; b: Asset; yesA: boolean; yesB: boolean; size?: number }) {
  return (
    <span className="tpair" aria-hidden="true">
      <ClaimIcon asset={a} yes={yesA} size={size} />
      <ClaimIcon asset={b} yes={yesB} size={size} />
    </span>
  );
}

/** QTL mark: the project glyph (a timeline that forks) in a lime disc. QTL has no external logo until the token launches. */
export function QtlMark({ size = 28 }: { size?: number }) {
  return (
    <span className="qtlmark" style={{ width: size, height: size }} title="QTL" aria-hidden="true">
      <svg viewBox="0 0 16 14"><path d="M1 7H6.5L13.5 2" /><path d="M6.5 7L13.5 12" /></svg>
    </span>
  );
}
