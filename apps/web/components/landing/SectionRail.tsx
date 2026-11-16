"use client";
import { useEffect, useState } from "react";

const ITEMS = [
  { id: "about", label: "Thesis" },
  { id: "scrub", label: "Settle it" },
  { id: "how-it-works", label: "Flow" },
  { id: "architecture", label: "Stack" },
  { id: "pools", label: "Pools" },
  { id: "resolution", label: "Oracle" },
  { id: "operators", label: "Roles" },
  { id: "settlement", label: "Execution" },
  { id: "transparency", label: "Spec" },
  { id: "contracts", label: "Contracts" },
  { id: "genesis", label: "Launch" },
] as const;

/** A quiet fixed index on the right edge: where you are on the page, and a way to jump. */
export default function SectionRail() {
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const present = ITEMS.filter((item) => document.getElementById(item.id)).map((item) => item.id);
    setIds(present);
    const sections = present.map((id) => document.getElementById(id)!) ;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );
    sections.forEach((el) => io.observe(el));
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.7);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, []);

  if (ids.length === 0) return null;
  const go = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    if (window.__lenis) window.__lenis.scrollTo(target, { duration: 1.4 });
    else target.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <nav className="rail-index" data-shown={shown} aria-label="Sections">
      {ITEMS.filter((item) => ids.includes(item.id)).map((item) => (
        <a key={item.id} href={`#${item.id}`} className={active === item.id ? "is-active" : undefined} onClick={go(item.id)} aria-label={item.label} aria-current={active === item.id ? "true" : undefined}>
          <span className="rail-index__label mono">{item.label}</span>
          <i />
        </a>
      ))}
    </nav>
  );
}
