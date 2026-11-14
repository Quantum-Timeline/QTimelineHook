import type { ReactNode } from "react";
import { Reveal } from "@/lib/motion";

export type GuideStep = { icon: ReactNode; title: string; body: string };

/** Side card that walks through what a page does, one step per row. */
export function GuideCard({ kicker, title, steps, footer }: { kicker: string; title: string; steps: GuideStep[]; footer?: ReactNode }) {
  return (
    <Reveal as="aside" className="guide">
      <span className="guide__kicker">{kicker}</span>
      <h2>{title}</h2>
      <ol>
        {steps.map((step, i) => (
          <li key={step.title} style={{ ["--n" as string]: i }}>
            <span className="guide__icon">{step.icon}</span>
            <div><strong>{step.title}</strong><p>{step.body}</p></div>
          </li>
        ))}
      </ol>
      {footer && <div className="guide__footer">{footer}</div>}
    </Reveal>
  );
}
