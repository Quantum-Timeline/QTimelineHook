"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

/** True when the visitor asked the OS for reduced motion. Server render assumes false; animations are CSS-gated too. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Fades and lifts its children in the first time they scroll into view. Content stays visible without JavaScript. */
export function Reveal({
  children, delay = 0, as: Tag = "div", className = "",
}: { children: ReactNode; delay?: number; as?: ElementType; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    setArmed(true);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setShown(true);
      observer.disconnect();
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = { "--reveal-delay": `${delay}ms` } as CSSProperties;
  return (
    <Tag ref={ref} className={`reveal ${armed && !shown ? "reveal--armed" : ""} ${shown ? "reveal--shown" : ""} ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}

/** Tweens a decimal string toward its latest value so quotes and balances glide instead of jumping. */
export function AnimatedNumber({ value, durationMs = 520 }: { value: string; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(Number(value));
  const frameRef = useRef(0);

  useEffect(() => {
    const target = Number(value);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const decimals = (value.split(".")[1] ?? "").length;
    if (reduce || !Number.isFinite(target) || !Number.isFinite(fromRef.current) || value === "n/a") {
      setShown(value);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    cancelAnimationFrame(frameRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4);
      const current = from + (target - from) * eased;
      setShown(t >= 1 ? value : current.toFixed(Math.min(decimals, 8)));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, durationMs]);

  return <span className="animated-number">{shown}</span>;
}

/** Whole seconds since mount plus a base chain timestamp, so countdowns follow chain time, not the visitor's clock. */
export function useChainNow(baseSeconds: bigint | undefined): bigint | undefined {
  const [now, setNow] = useState<bigint | undefined>(baseSeconds);
  useEffect(() => {
    if (baseSeconds === undefined) return;
    const startedAt = performance.now();
    setNow(baseSeconds);
    const timer = window.setInterval(() => {
      setNow(baseSeconds + BigInt(Math.floor((performance.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [baseSeconds]);
  return now;
}

export function formatCountdown(seconds: bigint): string {
  if (seconds <= 0n) return "00:00:00";
  const total = Number(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const hms = [hours, minutes, secs].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${hms}` : hms;
}
