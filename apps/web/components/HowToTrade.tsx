import Link from "next/link";

const steps = [
  { n: 1, title: "Connect your wallet", body: "Use the button at the top. We switch you to Robinhood Chain for you." },
  { n: 2, title: "Pick YES or NO and an amount", body: "YES if you think it happens, NO if not. You can start with a few dollars." },
  { n: 3, title: "Confirm, then check Positions", body: "Your shares show up in Positions. After the result, winning shares pay $1.00 each." },
];

/** Three plain steps so a first-time visitor knows what to do before touching anything. */
export function HowToTrade() {
  return (
    <section className="howto" aria-label="How to trade in three steps">
      <ol>
        {steps.map((step) => (
          <li key={step.n}>
            <span className="howto__n" aria-hidden="true">{step.n}</span>
            <div><strong>{step.title}</strong><p>{step.body}</p></div>
          </li>
        ))}
      </ol>
      <Link className="howto__link" href="/rules/">New here? Read how it works →</Link>
    </section>
  );
}
