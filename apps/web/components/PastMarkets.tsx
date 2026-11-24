import { eventProfile } from "@/lib/event-profile";
import { PAST_MARKETS, explorerAddress } from "@/lib/past-markets";

/** Ended markets, newest first. The market this build is showing is never listed here. */
export function PastMarkets({ heading = true }: { heading?: boolean }) {
  const items = PAST_MARKETS.filter((m) => m.event !== eventProfile.event);
  if (items.length === 0) return null;
  return (
    <section className="past" id="past" aria-label="Past markets">
      {heading && <h3 className="past__title">Past markets</h3>}
      <ul className="past__list">
        {items.map((m) => (
          <li key={m.marketId} className="past__item">
            <div className="past__head">
              <span className={`past__status past__status--${m.status === "Cancelled" ? "cancelled" : m.status === "Settled YES" ? "yes" : "no"}`}>{m.status}</span>
              <span className="past__window mono">{m.window}</span>
            </div>
            <p className="past__q">{m.question}</p>
            <p className="past__out">{m.outcome}</p>
            <a className="past__link mono" href={explorerAddress(m.vault)} target="_blank" rel="noreferrer">
              Market vault on the explorer ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
