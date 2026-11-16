/** The Robinhood wordmark as a bare inline logo. White by default; pass dark for light backgrounds. */
export function RobinhoodMark({ h = 14, dark = false }: { h?: number; dark?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rh-mark" src="/partners/robinhood-wordmark.svg" alt="Robinhood Chain" height={h} style={{ height: h, filter: dark ? "brightness(0)" : "brightness(0) invert(1)" }} />
  );
}
