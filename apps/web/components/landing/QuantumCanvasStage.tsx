"use client";

import { useEffect, useRef } from "react";

type QuantumCanvasStageProps = {
  progressRef: React.MutableRefObject<number>;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
};

type Vec3 = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mixColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): string {
  const k = clamp01(t);
  const r = Math.round(lerp(c1[0], c2[0], k));
  const g = Math.round(lerp(c1[1], c2[1], k));
  const b = Math.round(lerp(c1[2], c2[2], k));
  return `rgb(${r}, ${g}, ${b})`;
}

// Unit icosahedron vertices & edges for ML-DSA-44 lattice
const PHI = (1 + Math.sqrt(5)) / 2;
const RAW_VERTS: Vec3[] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
];
const ICO_VERTS: Vec3[] = RAW_VERTS.map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
});
const ICO_EDGES: Array<[number, number]> = [];
for (let i = 0; i < ICO_VERTS.length; i++) {
  for (let j = i + 1; j < ICO_VERTS.length; j++) {
    const d = Math.hypot(
      ICO_VERTS[i][0] - ICO_VERTS[j][0],
      ICO_VERTS[i][1] - ICO_VERTS[j][1],
      ICO_VERTS[i][2] - ICO_VERTS[j][2]
    );
    if (d < 1.15) ICO_EDGES.push([i, j]);
  }
}

export function QuantumCanvasStage({
  progressRef,
  mouseRef,
}: QuantumCanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Deterministic 3D star/particle field along Z
    const particles = Array.from({ length: 160 }, (_, i) => {
      const angle = i * 2.39996;
      const radius = 140 + ((i * 73) % 480);
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: (i / 160) * 1600,
        size: 1 + (i % 3) * 0.7,
        tone: i % 5 === 0 ? "amber" : "lime",
      };
    });

    const project = (
      x: number,
      y: number,
      z: number,
      camX: number,
      camY: number,
      fov = 560
    ): { sx: number; sy: number; scale: number; visible: boolean } => {
      const dz = z;
      if (dz < 18) return { sx: 0, sy: 0, scale: 0, visible: false };
      const scale = fov / dz;
      return {
        sx: width * 0.5 + (x - camX) * scale,
        sy: height * 0.5 + (y - camY) * scale,
        scale,
        visible: true,
      };
    };

    let rafId = 0;
    const start = performance.now();

    const render = (now: number) => {
      const t = reducedMotion ? 0 : (now - start) * 0.001;
      const p = clamp01(progressRef.current);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Light-theme window around chapter 3 (0.44..0.68)
      const creamIn = clamp01((p - 0.41) / 0.06);
      const creamOut = clamp01((0.70 - p) / 0.06);
      const lightMix = Math.min(creamIn, creamOut);

      const bgColor = mixColor([12, 18, 14], [245, 244, 239], lightMix);
      const inkLime = mixColor([207, 239, 140], [55, 109, 76], lightMix);
      const inkAmber = mixColor([194, 148, 64], [140, 102, 42], lightMix);
      const inkGrid = mixColor([207, 239, 140], [23, 25, 22], lightMix);

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      const camX = mx * 55 + Math.sin(p * Math.PI * 2) * 28;
      const camY = my * 36 + Math.cos(p * Math.PI * 1.5) * 18;

      // 1. Continuous 3D particle tunnel flying with scroll
      const travelZ = p * 2200 + t * 18;
      for (const pt of particles) {
        let z = ((pt.z - travelZ) % 1600 + 1600) % 1600;
        if (z < 25) z += 1600;
        const pr = project(pt.x, pt.y, z, camX, camY);
        if (!pr.visible) continue;
        const alpha = clamp01(1 - z / 1600) * (lightMix > 0.5 ? 0.28 : 0.65);
        ctx.fillStyle = pt.tone === "amber" ? inkAmber : inkLime;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, Math.max(0.8, pt.size * pr.scale * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 2. Perspective floor & ceiling architectural grid lines
      ctx.strokeStyle = inkGrid;
      ctx.lineWidth = 1;
      for (let gz = 1; gz <= 10; gz++) {
        const z = ((gz * 160 - (travelZ % 160)) + 160) % 1600;
        if (z < 40) continue;
        const a = clamp01(1 - z / 1500) * (lightMix > 0.5 ? 0.08 : 0.14);
        ctx.globalAlpha = a;
        const leftTop = project(-750, -320, z, camX, camY);
        const rightTop = project(750, -320, z, camX, camY);
        const leftBot = project(-750, 320, z, camX, camY);
        const rightBot = project(750, 320, z, camX, camY);
        if (leftTop.visible && rightTop.visible) {
          ctx.beginPath();
          ctx.moveTo(leftTop.sx, leftTop.sy);
          ctx.lineTo(rightTop.sx, rightTop.sy);
          ctx.stroke();
        }
        if (leftBot.visible && rightBot.visible) {
          ctx.beginPath();
          ctx.moveTo(leftBot.sx, leftBot.sy);
          ctx.lineTo(rightBot.sx, rightBot.sy);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // 3. ZONE 1 & 2 (0.00 -> 0.45): 3D Bifurcating Timeline Rails
      const forkVis = 1 - clamp01((p - 0.38) / 0.10);
      if (forkVis > 0.01) {
        const splitAmount = clamp01((p - 0.05) / 0.28);
        ctx.save();
        ctx.globalAlpha = forkVis;

        // Incoming single timeline beam
        const steps = 26;
        ctx.strokeStyle = lightMix > 0.5 ? "#171916" : "#fffefa";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const z = lerp(950, 420, u);
          const pr = project(0, 0, z, camX, camY);
          if (i === 0) ctx.moveTo(pr.sx, pr.sy);
          else ctx.lineTo(pr.sx, pr.sy);
        }
        ctx.stroke();

        // Diverging YES (emerald-lime) & NO (amber) 3D rails
        const drawBranch = (dir: number, color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          for (let i = 0; i <= 32; i++) {
            const u = i / 32;
            const z = lerp(420, 110, u);
            const spread = Math.pow(u, 1.35) * (90 + splitAmount * 220);
            const x = dir * spread;
            const y = dir * -spread * 0.42 + Math.sin(u * 4 + t) * 8;
            const pr = project(x, y, z, camX, camY);
            if (i === 0) ctx.moveTo(pr.sx, pr.sy);
            else ctx.lineTo(pr.sx, pr.sy);
          }
          ctx.stroke();

          // Node pulse at end of branch
          const endPr = project(
            dir * (90 + splitAmount * 220),
            dir * -(90 + splitAmount * 220) * 0.42,
            110,
            camX,
            camY
          );
          if (endPr.visible) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(endPr.sx, endPr.sy, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        };

        drawBranch(-1, inkLime);
        drawBranch(1, inkAmber);
        ctx.restore();
      }

      // 4. ZONE 3 (0.40 -> 0.72): Three-Pool Orbital Rings
      const poolVis =
        clamp01((p - 0.36) / 0.08) * (1 - clamp01((p - 0.68) / 0.08));
      if (poolVis > 0.01) {
        const localP = clamp01((p - 0.40) / 0.28);
        ctx.save();
        ctx.globalAlpha = poolVis * 0.85;
        const centers: Array<[number, number, number, string]> = [
          [-210, -40, 380, inkLime],
          [210, -40, 380, inkAmber],
          [0, 125, 320, inkGrid],
        ];
        centers.forEach(([cx, cy, cz, col], idx) => {
          const rot = t * (0.4 + idx * 0.15) + localP * Math.PI * 2;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let a = 0; a <= 48; a++) {
            const ang = (a / 48) * Math.PI * 2;
            const rx = Math.cos(ang) * 95;
            const ry = Math.sin(ang) * 95 * Math.cos(rot * 0.5);
            const rz = Math.sin(ang) * 95 * Math.sin(rot * 0.5);
            const pr = project(cx + rx, cy + ry, cz + rz, camX, camY);
            if (!pr.visible) continue;
            if (a === 0) ctx.moveTo(pr.sx, pr.sy);
            else ctx.lineTo(pr.sx, pr.sy);
          }
          ctx.closePath();
          ctx.stroke();
        });
        ctx.restore();
      }

      // 5. ZONE 4 & 5 (0.64 -> 1.00): 3D ML-DSA-44 Geodesic Lattice
      const latticeVis = clamp01((p - 0.64) / 0.09);
      if (latticeVis > 0.01) {
        const localP = clamp01((p - 0.66) / 0.34);
        const rx = t * 0.28 + localP * 2.1;
        const ry = t * 0.42 + localP * 3.0;
        const radius = lerp(190, 155, localP);
        const centerZ = lerp(340, 440, localP);

        const rotated = ICO_VERTS.map(([vx, vy, vz]) => {
          // Rotate Y
          const x1 = vx * Math.cos(ry) - vz * Math.sin(ry);
          const z1 = vx * Math.sin(ry) + vz * Math.cos(ry);
          // Rotate X
          const y2 = vy * Math.cos(rx) - z1 * Math.sin(rx);
          const z2 = vy * Math.sin(rx) + z1 * Math.cos(rx);
          return project(
            x1 * radius,
            y2 * radius,
            centerZ + z2 * radius,
            camX,
            camY
          );
        });

        ctx.save();
        ctx.globalAlpha = latticeVis * 0.55;
        ctx.strokeStyle = inkLime;
        ctx.lineWidth = 1.25;
        for (const [i, j] of ICO_EDGES) {
          const a = rotated[i];
          const b = rotated[j];
          if (!a.visible || !b.visible) continue;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        ctx.fillStyle = inkLime;
        for (const pt of rotated) {
          if (!pt.visible) continue;
          ctx.beginPath();
          ctx.arc(pt.sx, pt.sy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [progressRef, mouseRef]);

  return (
    <canvas
      ref={canvasRef}
      className="qt-canvas-stage"
      aria-hidden="true"
    />
  );
}
