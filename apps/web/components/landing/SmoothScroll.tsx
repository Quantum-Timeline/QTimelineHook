"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

gsap.registerPlugin(ScrollTrigger);

const SCRAMBLE_CHARS = "QTIMELINE01#/<>_";

export default function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      lerp: 0.085,
      smoothWheel: true,
      prevent: () => false,
    });
    window.__lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);

    const onTick = (time: number) => {
      lenis.raf(1000 * time);
    };
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
      delete window.__lenis;
    };
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.location.hash) {
      const target = document.querySelector<HTMLElement>(window.location.hash);
      if (target) {
        window.__lenis?.scrollTo(target, { immediate: true, force: true });
      }
    } else {
      window.__lenis?.scrollTo(0, { immediate: true, force: true });
    }

    const cleanups: Array<() => void> = [];

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set("[data-reveal]", { opacity: 1 });
        gsap.set(".split .wi", { yPercent: 0, y: 0 });
        return;
      }

      // Top scroll progress hairline
      const progressEl = document.querySelector<HTMLElement>("[data-scroll-progress]");
      if (progressEl) {
        gsap.to(progressEl, {
          scaleX: 1,
          ease: "none",
          scrollTrigger: {
            trigger: document.documentElement,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.25,
          },
        });
      }

      // Pinned horizontal scroll rail
      gsap.matchMedia().add("(min-width: 1024px)", () => {
        gsap.utils.toArray<HTMLElement>("[data-hscroll]").forEach((railEl) => {
          const trackEl = railEl.querySelector<HTMLElement>("[data-track]");
          if (!trackEl) return;
          const getDistance = () => Math.max(0, trackEl.scrollWidth - window.innerWidth);
          gsap.to(trackEl, {
            x: () => -getDistance(),
            ease: "none",
            scrollTrigger: {
              trigger: railEl,
              start: "top top",
              end: () => `+=${getDistance()}`,
              pin: true,
              scrub: 0.85,
              invalidateOnRefresh: true,
            },
          });
        });
      });

      ScrollTrigger.refresh();

      // Section & element reveals
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 44, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 1.15,
            ease: "expo.out",
            delay: Number(el.dataset.delay ?? 0),
            scrollTrigger: {
              trigger: el,
              start: "top 92%",
              once: true,
            },
          }
        );
      });

      // Split word reveals
      gsap.utils.toArray<HTMLElement>(".split").forEach((el) => {
        gsap.fromTo(
          el.querySelectorAll(".wi"),
          { yPercent: 115, y: 0 },
          {
            yPercent: 0,
            y: 0,
            duration: 1.25,
            ease: "expo.out",
            stagger: 0.06,
            delay: Number(el.dataset.delay ?? 0),
            scrollTrigger: {
              trigger: el,
              start: "top 92%",
              once: true,
            },
          }
        );
      });

      // Cipher text scramble
      gsap.utils.toArray<HTMLElement>("[data-scramble]").forEach((el) => {
        ScrollTrigger.create({
          trigger: el,
          start: "top 92%",
          once: true,
          onEnter: () =>
            window.setTimeout(() => {
              const original = el.dataset.text ?? el.textContent ?? "";
              el.dataset.text = original;
              let frame = 0;
              const step = () => {
                const resolvedCount = Math.floor((++frame / 24) * original.length);
                let out = "";
                for (let i = 0; i < original.length; i++) {
                  const ch = original[i];
                  if (i < resolvedCount || ch === " ") {
                    out += ch;
                  } else {
                    out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
                  }
                }
                el.textContent = out;
                if (frame < 24) {
                  requestAnimationFrame(step);
                } else {
                  el.textContent = original;
                }
              };
              step();
            }, 1000 * Number(el.dataset.delay ?? 0)),
        });
      });

      // Animated counters
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const targetVal = Number(el.dataset.count);
        const state = { v: 0 };
        gsap.to(state, {
          v: targetVal,
          duration: 2.0,
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 92%",
            once: true,
          },
          onUpdate: () => {
            el.textContent =
              targetVal >= 1900 && targetVal <= 4700
                ? String(Math.round(state.v))
                : Math.round(state.v).toLocaleString("en-US");
          },
        });
      });

      // Manifesto word-by-word scroll scrub
      gsap.utils.toArray<HTMLElement>("[data-words]").forEach((el) => {
        gsap.fromTo(
          el.querySelectorAll(".mw"),
          { opacity: 0.14 },
          {
            opacity: 1,
            stagger: 0.08,
            ease: "none",
            scrollTrigger: {
              trigger: el,
              start: "top 80%",
              end: "bottom 45%",
              scrub: true,
            },
          }
        );
      });

      // Portal ring scroll-scrubbed rotation & scale
      const portalRing = document.querySelector<HTMLElement>(".portal__ring");
      if (portalRing) {
        gsap.fromTo(
          portalRing,
          { scale: 0.82, rotate: -25 },
          {
            scale: 1.08,
            rotate: 35,
            ease: "none",
            scrollTrigger: {
              trigger: portalRing,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          }
        );
      }

      // The marquee leans into the scroll: skew follows scroll velocity and settles back
      const marquee = document.querySelector<HTMLElement>(".marquee");
      if (marquee) {
        ScrollTrigger.create({
          trigger: marquee,
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            gsap.to(marquee, { skewX: gsap.utils.clamp(-10, 10, self.getVelocity() / -140), duration: 0.5, ease: "power3.out", overwrite: "auto" });
          },
        });
      }

      // Fine-pointer magnetic buttons & 3D card tilt
      if (window.matchMedia("(pointer: fine)").matches) {
        document.querySelectorAll<HTMLElement>(".hdr__app-btn, .cta__btn, .plist__site").forEach((btn) => {
          const onMove = (e: MouseEvent) => {
            const r = btn.getBoundingClientRect();
            const dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
            const dy = (e.clientY - (r.top + r.height / 2)) * 0.22;
            gsap.to(btn, { x: dx, y: dy, duration: 0.35, ease: "power3.out" });
          };
          const onLeave = () => {
            gsap.to(btn, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.4)" });
          };
          btn.addEventListener("mousemove", onMove);
          btn.addEventListener("mouseleave", onLeave);
          cleanups.push(() => {
            btn.removeEventListener("mousemove", onMove);
            btn.removeEventListener("mouseleave", onLeave);
          });
        });

        document.querySelectorAll<HTMLElement>(".card").forEach((card) => {
          const onMove = (e: MouseEvent) => {
            const r = card.getBoundingClientRect();
            const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
            const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
            gsap.to(card, {
              rotateX: rx,
              rotateY: ry,
              transformPerspective: 900,
              duration: 0.4,
              ease: "power2.out",
            });
          };
          const onLeave = () => {
            gsap.to(card, {
              rotateX: 0,
              rotateY: 0,
              duration: 0.6,
              ease: "power3.out",
            });
          };
          card.addEventListener("mousemove", onMove);
          card.addEventListener("mouseleave", onLeave);
          cleanups.push(() => {
            card.removeEventListener("mousemove", onMove);
            card.removeEventListener("mouseleave", onLeave);
          });
        });
      }

      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    });

    const refresh = () => ScrollTrigger.refresh();
    const timer = window.setTimeout(refresh, 450);
    document.fonts?.ready.then(refresh).catch(() => {});

    return () => {
      clearTimeout(timer);
      cleanups.forEach((fn) => fn());
      ctx.revert();
    };
  }, [pathname]);

  return null;
}
