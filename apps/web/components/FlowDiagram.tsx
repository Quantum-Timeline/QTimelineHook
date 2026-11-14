/** Static-export-safe SVG: one deposit forks into two timelines and resolves through the hybrid-signed report. */
export function FlowDiagram() {
  return (
    <figure className="flow" aria-label="How a market flows from deposit to payout">
      <svg viewBox="0 0 860 300" role="img" aria-labelledby="flow-title flow-desc">
        <title id="flow-title">Deposit, split, trade, resolve, redeem</title>
        <desc id="flow-desc">One deposit splits into YES and NO claims. Each timeline trades in its own Uniswap v4 pool. A hybrid-signed BEA report decides which side redeems one to one.</desc>

        <path className="flow__wire flow__wire--base" d="M150 150 H250" />
        <path className="flow__wire flow__wire--yes" d="M330 150 C 380 150, 380 80, 430 80 H 560" />
        <path className="flow__wire flow__wire--no" d="M330 150 C 380 150, 380 220, 430 220 H 560" />
        <path className="flow__wire flow__wire--base" d="M650 80 C 700 80, 700 150, 740 150" />
        <path className="flow__wire flow__wire--base" d="M650 220 C 700 220, 700 150, 740 150" />
        <path className="flow__wire flow__wire--mid" d="M430 150 H 560" />

        <g className="flow__node">
          <rect x="30" y="118" width="120" height="64" />
          <text x="90" y="146">DEPOSIT</text>
          <text x="90" y="166" className="flow__sub">ETH or USDG</text>
        </g>
        <g className="flow__node flow__node--core">
          <rect x="250" y="118" width="80" height="64" />
          <text x="290" y="146">SPLIT</text>
          <text x="290" y="166" className="flow__sub">vault</text>
        </g>
        <g className="flow__node flow__node--yes">
          <rect x="560" y="50" width="90" height="60" />
          <text x="605" y="76">ETH · YES</text>
          <text x="605" y="94" className="flow__sub">v4 pool</text>
        </g>
        <g className="flow__node">
          <rect x="560" y="120" width="90" height="60" />
          <text x="605" y="146">YES / NO</text>
          <text x="605" y="164" className="flow__sub">odds pool</text>
        </g>
        <g className="flow__node flow__node--no">
          <rect x="560" y="190" width="90" height="60" />
          <text x="605" y="216">ETH · NO</text>
          <text x="605" y="234" className="flow__sub">v4 pool</text>
        </g>
        <g className="flow__node flow__node--core">
          <rect x="740" y="112" width="100" height="76" />
          <text x="790" y="140">BEA</text>
          <text x="790" y="158" className="flow__sub">ECDSA + ML-DSA</text>
          <text x="790" y="174" className="flow__sub">winner 1:1</text>
        </g>

        <circle className="flow__pulse flow__pulse--yes" r="4"><animateMotion dur="3.2s" repeatCount="indefinite" path="M330 150 C 380 150, 380 80, 430 80 H 560" /></circle>
        <circle className="flow__pulse flow__pulse--no" r="4"><animateMotion dur="3.2s" begin="1.1s" repeatCount="indefinite" path="M330 150 C 380 150, 380 220, 430 220 H 560" /></circle>
        <circle className="flow__pulse" r="4"><animateMotion dur="2.4s" repeatCount="indefinite" path="M150 150 H250" /></circle>
      </svg>
    </figure>
  );
}
