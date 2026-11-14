import { ClaimIcon } from "@/components/TokenLogo";

/** The product's signature: one timeline enters from the left and forks into a YES world and a NO world. */
export function ForkHero({ yesLabel = "YES world", noLabel = "NO world", caption }: { yesLabel?: string; noLabel?: string; caption?: string }) {
  return (
    <figure className="fork" aria-label="One timeline forking into a YES world and a NO world">
      <svg viewBox="0 0 560 360" aria-hidden="true">
        <defs>
          <linearGradient id="fork-yes" x1="0" x2="1"><stop offset="0" stopColor="#cfef8c" stopOpacity="0.15" /><stop offset="1" stopColor="#cfef8c" /></linearGradient>
          <linearGradient id="fork-no" x1="0" x2="1"><stop offset="0" stopColor="#f0a58f" stopOpacity="0.15" /><stop offset="1" stopColor="#f0a58f" /></linearGradient>
          <linearGradient id="fork-in" x1="0" x2="1"><stop offset="0" stopColor="#f3f2ec" stopOpacity="0" /><stop offset="1" stopColor="#f3f2ec" stopOpacity="0.9" /></linearGradient>
        </defs>

        <path className="fork__trunk" d="M0 180 H190" stroke="url(#fork-in)" />
        <path id="fork-p-yes" className="fork__branch" d="M190 180 C 270 180, 290 80, 380 80 H 500" stroke="url(#fork-yes)" />
        <path id="fork-p-no" className="fork__branch" d="M190 180 C 270 180, 290 280, 380 280 H 500" stroke="url(#fork-no)" />
        <path className="fork__ghost" d="M190 180 H 500" />

        <circle className="fork__node" cx="190" cy="180" r="9" />
        <circle className="fork__node-ring" cx="190" cy="180" r="9" />

        <circle className="fork__end fork__end--yes" cx="500" cy="80" r="7" />
        <circle className="fork__end fork__end--no" cx="500" cy="280" r="7" />

        <circle className="fork__pulse fork__pulse--in" r="4"><animateMotion dur="2.6s" repeatCount="indefinite" path="M0 180 H190" /></circle>
        <circle className="fork__pulse fork__pulse--yes" r="4.5"><animateMotion dur="3.4s" begin="0.4s" repeatCount="indefinite" path="M190 180 C 270 180, 290 80, 380 80 H 500" /></circle>
        <circle className="fork__pulse fork__pulse--no" r="4.5"><animateMotion dur="3.4s" begin="1.6s" repeatCount="indefinite" path="M190 180 C 270 180, 290 280, 380 280 H 500" /></circle>
      </svg>

      <div className="fork__tag fork__tag--yes"><ClaimIcon asset="ETH" yes size={34} /><div><strong>{yesLabel}</strong><small>ETH if it happens</small></div></div>
      <div className="fork__tag fork__tag--no"><ClaimIcon asset="ETH" yes={false} size={34} /><div><strong>{noLabel}</strong><small>ETH if it doesn&rsquo;t</small></div></div>
      <div className="fork__now"><span>now</span></div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
