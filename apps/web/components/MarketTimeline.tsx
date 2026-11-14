"use client";

import { formatCountdown, useChainNow } from "@/lib/motion";

type Props = {
  status: number;
  activated: boolean;
  opensAt: bigint;
  cutoffAt: bigint;
  releaseAt: bigint;
  deadline: bigint;
  chainTimestamp: bigint;
};

const STAGES = ["Opens", "Cutoff", "Release", "Deadline"] as const;

/** Live lifecycle rail: where the market is between open, cutoff, BEA release and the cancellation deadline. */
export function MarketTimeline({ status, activated, opensAt, cutoffAt, releaseAt, deadline, chainTimestamp }: Props) {
  const now = useChainNow(chainTimestamp) ?? chainTimestamp;
  const terminal = status === 4 || status === 5 || status === 6 || status === 7;
  const marks = [opensAt, cutoffAt, releaseAt, deadline];
  const span = Number(deadline - opensAt) || 1;
  const progress = terminal ? 1 : Math.min(1, Math.max(0, Number(now - opensAt) / span));
  const stageIndex = terminal ? 3 : now < opensAt ? -1 : now < cutoffAt ? 0 : now < releaseAt ? 1 : now < deadline ? 2 : 3;

  let headline = "Waiting for activation";
  let target: bigint | undefined;
  if (terminal) headline = status === 4 ? "Resolved · YES" : status === 5 ? "Resolved · NO" : status === 6 ? "Cancelled · 50% payout" : "Discarded";
  else if (activated) {
    if (now < opensAt) { headline = "Trading opens in"; target = opensAt; }
    else if (now < cutoffAt) { headline = "Trading closes in"; target = cutoffAt; }
    else if (now < releaseAt) { headline = "BEA release in"; target = releaseAt; }
    else if (now < deadline) { headline = "Report deadline in"; target = deadline; }
    else headline = "Awaiting cancellation";
  }

  return (
    <div className="mtl" data-state={terminal ? "terminal" : stageIndex < 0 ? "scheduled" : "live"}>
      <div className="mtl__head">
        <span className="mtl__label">LIFECYCLE</span>
        <span className="mtl__count">
          <small>{headline}</small>
          {target !== undefined && <b className="mtl__clock">{formatCountdown(target - now)}</b>}
        </span>
      </div>
      <div className="mtl__rail" role="img" aria-label={`Market lifecycle ${Math.round(progress * 100)}% elapsed`}>
        <div className="mtl__track" />
        <div className="mtl__fill" style={{ transform: `scaleX(${progress})` }} />
        {marks.map((mark, i) => (
          <div key={STAGES[i]} className={`mtl__stop ${i <= stageIndex ? "is-done" : ""} ${i === stageIndex && !terminal ? "is-current" : ""}`}
            style={{ left: `${(Number(mark - opensAt) / span) * 100}%` }}>
            <i />
          </div>
        ))}
        <div className="mtl__head-dot" style={{ left: `${progress * 100}%` }} />
      </div>
      <div className="mtl__legend">
        {marks.map((mark, i) => (
          <div key={STAGES[i]} className={i <= stageIndex ? "is-done" : ""}>
            <span>{STAGES[i]}</span>
            <time dateTime={new Date(Number(mark) * 1000).toISOString()}>
              {new Date(Number(mark) * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        ))}
      </div>
    </div>
  );
}
