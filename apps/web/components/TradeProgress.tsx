"use client";

export type TradeStep = { key: string; label: string };
export type StepState = "pending" | "active" | "done" | "failed";

/** Animated transaction stepper: shows which wallet or chain step the trade is waiting on. */
export function TradeProgress({ steps, current, failed, done }: { steps: TradeStep[]; current: number; failed: boolean; done: boolean }) {
  return (
    <ol className="tprog" aria-live="polite">
      {steps.map((step, i) => {
        const state: StepState = failed && i === current ? "failed" : done || i < current ? "done" : i === current ? "active" : "pending";
        return (
          <li key={step.key} className={`tprog__step is-${state}`}>
            <span className="tprog__node" aria-hidden="true">
              {state === "done" ? (
                <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
              ) : state === "failed" ? (
                <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              ) : (
                <i />
              )}
            </span>
            <span className="tprog__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
