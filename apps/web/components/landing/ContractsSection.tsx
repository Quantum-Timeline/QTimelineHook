"use client";

import React, { useState } from "react";
import { RobinhoodMark } from "@/components/RobinhoodMark";

type ContractEntry = {
  name: string;
  kind: string;
  role: string;
  address: `0x${string}`;
};

const EXPLORER_BASE = "https://robinhoodchain.blockscout.com/address";

const MAINNET_CONTRACTS: ContractEntry[] = [
  {
    name: "IpoMarketRegistry",
    kind: "CORE",
    role: "Market state, cutoff & pool registry",
    address: "0x5444CF6E91462938C975668266c9E24b6233BD37",
  },
  {
    name: "IpoMarketFactory",
    kind: "CORE",
    role: "Deploys vault, outcome tokens, hook & 3 pools",
    address: "0xDb882dBD0da7ed65d4C360b5B18B9bd93ceAFde6",
  },
  {
    name: "TimelineRouter",
    kind: "ROUTER",
    role: "Atomic split, merge & conditional swap router",
    address: "0x401a0A3A8e32ABaA7f66EE7247D592f47784DF45",
  },
  {
    name: "IpoResolutionAdapter",
    kind: "ORACLE",
    role: "SEC Form 424B4 hybrid oracle adapter",
    address: "0x741C847f54CeebD6A4D1A32341f73fb62eb80fbA",
  },
  {
    name: "IpoHookDeployer",
    kind: "HOOK",
    role: "CREATE2 deployer for each market's beforeSwap cutoff hook",
    address: "0xaAa28FA6a7DB709129879c1daF13Bc90B843064f",
  },
  {
    name: "IpoTimelineHook beacon",
    kind: "BEACON",
    role: "Upgrade point for every market's cutoff hook",
    address: "0xa9928908754d2876613787E362bc35DA559C97FE",
  },
  {
    name: "IpoConditionalVault beacon",
    kind: "BEACON",
    role: "Upgrade point for every market's 1:1 USDG-backed YES/NO vault",
    address: "0x326be2C0e8883dd7b24d3afD17d9f37B3D512329",
  },
  {
    name: "IpoOutcomeToken beacon",
    kind: "BEACON",
    role: "Upgrade point for the four YES/NO claim tokens of each market",
    address: "0xCD8B0EB1025215A7C64af28D1Aa45b9f12a44214",
  },
  {
    name: "MLDSA44Verifier",
    kind: "PQ CRYPTO",
    role: "NIST FIPS 204 module-lattice signature verifier",
    address: "0x668Fe10f9b424349FDD41F7E6C5DF2cC21Bf3214",
  },
  {
    name: "PQKeyRegistry",
    kind: "PQ CRYPTO",
    role: "Post-quantum resolver public-key commitments",
    address: "0x78F42d96AD69Ed3D696875CF59eFF8A447Cd80A8",
  },
  {
    name: "F1600Helper",
    kind: "PQ CRYPTO",
    role: "Keccak-f[1600] SHAKE256 sponge precompile helper",
    address: "0x0438deB1f25BA0D88D257acfe89191B3EB3de75F",
  },
  {
    name: "PoolManager",
    kind: "UNISWAP V4",
    role: "Canonical Uniswap v4 singleton pool manager",
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  },
  {
    name: "PositionManager",
    kind: "UNISWAP V4",
    role: "Holds the market's concentrated liquidity positions",
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
  },
  {
    name: "Quoter",
    kind: "UNISWAP V4",
    role: "Conditional swap & price discovery quoter",
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  },
  {
    name: "USDG",
    kind: "SETTLEMENT",
    role: "Collateral & 1:1 winning claim payout asset",
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function ContractsSection() {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      window.setTimeout(() => setCopied((prev) => (prev === addr ? null : prev)), 1500);
    } catch {
      // Clipboard API unavailable in non-secure context
    }
  };

  return (
    <section className="section contracts" id="contracts" data-dim="0.55">
      <div className="wrap">
        <div className="contracts__head" data-reveal>
          <div>
            <p className="eyebrow">
              <span className="eyebrow__n">RH·4663</span>Mainnet Registry · Block #114,269,075
            </p>
            <h2 className="split display-md" data-reveal>
              Deployed &amp; sealed on-chain.
            </h2>
          </div>
          <div className="contracts__meta mono">
            <span>SYSTEM / anthropic-ipo-pricing</span>
            <span className="rh-inline">CHAIN / <RobinhoodMark h={13} /> <i>Mainnet (4663)</i></span>
            <span className="contracts__status">STATUS / Deployed &amp; Sealed</span>
          </div>
        </div>

        <div className="contracts__grid">
          {MAINNET_CONTRACTS.map((item) => {
            const isCopied = copied === item.address;
            return (
              <article key={item.name} className="contract-card" data-reveal>
                <div className="contract-card__top">
                  <span className="contract-card__kind mono">{item.kind}</span>
                  <div className="contract-card__actions mono">
                    <button
                      type="button"
                      className={`contract-card__copy${isCopied ? " is-copied" : ""}`}
                      onClick={() => handleCopy(item.address)}
                      aria-label={`Copy ${item.name} address`}
                      data-cursor
                    >
                      {isCopied ? "Copied" : "Copy"}
                    </button>
                    <a
                      href={`${EXPLORER_BASE}/${item.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="contract-card__ext"
                      aria-label={`View ${item.name} on Robinhood Explorer`}
                      data-cursor
                    >
                      Explorer ↗
                    </a>
                  </div>
                </div>

                <h3 className="contract-card__name">{item.name}</h3>
                <p className="contract-card__role">{item.role}</p>

                <div className="contract-card__addr mono" title={item.address}>
                  <span>{shortAddr(item.address)}</span>
                  <span className="contract-card__full">{item.address}</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
