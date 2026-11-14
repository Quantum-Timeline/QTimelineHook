"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

let seedState = 1337;
const seededRandom = () => ((seedState = (16807 * seedState) % 0x7fffffff) - 1) / 0x7ffffffe;

export function QTimelineStackedMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 204 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Architectural Bifurcation Emblem (pure vector paths for crisp WebGL particle sampling) */}
      <g fill="currentColor">
        <path d="M102 8 L146 33 V83 L102 108 L58 83 V33 L102 8 Z M102 17 L66 38 V78 L102 99 L138 78 V38 L102 17 Z" />
        <path d="M72 58 H94 L106 40 H128 V47 H110 L100 62 L110 77 H128 V84 H106 L94 65 H72 V58 Z" />
        <circle cx="95" cy="61.5" r="5" />
      </g>
      {/* Pure Vector Block Wordmark: QTIMELINE */}
      <g fill="currentColor">
        {/* Q */}
        <path d="M18 124 h16 v20 h-4 l3 4 h-5 l-3 -4 h-7 v-20 z m4 4 v12 h8 v-12 h-8 z" />
        {/* T */}
        <path d="M40 124 h16 v4 h-6 v16 h-4 v-16 h-6 v-4 z" />
        {/* I */}
        <path d="M62 124 h4 v20 h-4 v-20 z" />
        {/* M */}
        <path d="M73 124 h4 l5 9 l5 -9 h4 v20 h-4 v-12 l-5 8 l-5 -8 v12 h-4 v-20 z" />
        {/* E */}
        <path d="M98 124 h14 v4 h-10 v4 h8 v4 h-8 v4 h10 v4 h-14 v-20 z" />
        {/* L */}
        <path d="M118 124 h4 v16 h10 v4 h-14 v-20 z" />
        {/* I */}
        <path d="M138 124 h4 v20 h-4 v-20 z" />
        {/* N */}
        <path d="M149 124 h4 l8 12 v-12 h4 v20 h-4 l-8 -12 v12 h-4 v-20 z" />
        {/* E */}
        <path d="M172 124 h14 v4 h-10 v4 h8 v4 h-8 v4 h10 v4 h-14 v-20 z" />
      </g>
    </svg>
  );
}

async function sampleSvgParticles(svgEl: SVGSVGElement, targetWidth: number, step: number) {
  const vb = svgEl.viewBox.baseVal;
  const targetHeight = Math.round((targetWidth * vb.height) / vb.width);
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(targetWidth));
  clone.setAttribute("height", String(targetHeight));
  const serialized = new XMLSerializer()
    .serializeToString(clone)
    .replace(/currentColor/g, "#fff");
  const blobUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = blobUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d");
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const data = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
    const pts: number[] = [];
    for (let y = 0; y < targetHeight; y += step) {
      for (let x = 0; x < targetWidth; x += step) {
        if (data[(y * targetWidth + x) * 4 + 3] < 110) continue;
        const jx = x + (seededRandom() - 0.5) * step * 0.6;
        const jy = y + (seededRandom() - 0.5) * step * 0.6;
        pts.push(jx / targetWidth - 0.5, 0.5 - jy / targetHeight);
      }
    }
    return { pts, aspect: targetHeight / targetWidth, cols: targetWidth / step };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const VERT_PARTICLES = `
  attribute vec3 aStart;
  attribute vec4 aRnd;
  uniform float uTime, uProgress, uDissolve, uScan, uSize, uPR, uDim;
  varying float vAlpha, vGlow, vFly;

  void main() {
    float delay = aRnd.x * 0.42;
    float t = clamp((uProgress - delay) / 0.58, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);

    float ang = (1.0 - e) * (2.4 + aRnd.y * 2.2);
    float c = cos(ang), s = sin(ang);
    vec3 sr = vec3(aStart.x * c - aStart.z * s, aStart.y, aStart.x * s + aStart.z * c);
    vec3 p = mix(sr, position, e);
    p.z += sin(e * 3.14159) * (aRnd.w - 0.5) * 1.6;
    p.z += sin(uTime * 2.2 + aRnd.z * 6.2831) * 0.012 * e;

    vec3 dir = normalize(vec3(position.xy * 2.0, 0.6) + (aRnd.xyz - 0.5) * 1.4);
    p += dir * uDissolve * uDissolve * (2.5 + aRnd.w * 5.0);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float d = (position.y - uScan) * 16.0;
    vGlow = exp(-d * d);
    vFly = 1.0 - e;
    gl_PointSize = uSize * uPR * (1.0 + vGlow * 1.4 + vFly * 1.3) * (6.0 / -mv.z);
    vAlpha = smoothstep(0.0, 0.25, t + 0.06) * (1.0 - uDissolve) * mix(1.0, uDim, e);
  }
`;

const FRAG_PARTICLES = `
  uniform vec3 uColor, uAccent;
  varying float vAlpha, vGlow, vFly;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float a = 1.0 - r * 2.0;
    a *= a;
    vec3 col = mix(uColor, uAccent, clamp(vFly * 1.5 + vGlow * 0.8, 0.0, 1.0)) + vGlow * 0.7;
    gl_FragColor = vec4(col, a * min(1.0, vAlpha + vGlow * 0.6));
  }
`;

const VERT_DUST = `
  uniform float uTime, uPR, uAlpha;
  attribute float aRnd;
  varying float vA;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.4 + aRnd * 30.0) * 0.08;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.0 + aRnd * 2.0) * uPR * (6.0 / -mv.z);
    vA = (0.15 + aRnd * 0.35) * uAlpha * (0.6 + 0.4 * sin(uTime * 1.5 + aRnd * 40.0));
  }
`;

const FRAG_DUST = `
  uniform vec3 uAccent;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(uAccent, (1.0 - r * 2.0) * vA);
  }
`;

const FRAG_SCAN = `
  uniform float uAlpha;
  uniform vec3 uAccent;
  varying vec2 vUv;
  void main() {
    float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float y = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float a = pow(x, 1.5) * pow(y, 6.0) * uAlpha;
    gl_FragColor = vec4(mix(uAccent, vec3(1.0), y * y), a);
  }
`;

async function createLoaderScene(canvas: HTMLCanvasElement, svgEl: SVGSVGElement) {
  const isSmall = window.innerWidth < 720;
  const { pts, aspect, cols } = await sampleSvgParticles(svgEl, isSmall ? 300 : 380, 2);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
  });
  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.z = 6;

  const worldPerPx = (12 * Math.tan(THREE.MathUtils.degToRad(17.5))) / window.innerHeight;
  const rect = svgEl.getBoundingClientRect();
  const widthWorld = rect.width * worldPerPx;
  const heightWorld = widthWorld * aspect;
  const offsetX = (rect.left + rect.width / 2 - window.innerWidth / 2) * worldPerPx;
  const offsetY = -(rect.top + rect.height / 2 - window.innerHeight / 2) * worldPerPx;
  const ptScale = rect.width / cols;
  const count = pts.length / 2;

  const posArr = new Float32Array(3 * count);
  const startArr = new Float32Array(3 * count);
  const rndArr = new Float32Array(4 * count);

  for (let i = 0; i < count; i++) {
    const px = pts[2 * i];
    const py = pts[2 * i + 1];
    posArr[3 * i] = px * widthWorld;
    posArr[3 * i + 1] = py * heightWorld;

    const theta = seededRandom() * Math.PI * 2;
    const phi = Math.acos(2 * seededRandom() - 1);
    const rad = 2.6 + 4.5 * seededRandom();
    startArr[3 * i] = rad * Math.sin(phi) * Math.cos(theta) * 1.3;
    startArr[3 * i + 1] = rad * Math.sin(phi) * Math.sin(theta) * 0.8;
    startArr[3 * i + 2] = Math.min(2.5, rad * Math.cos(phi) - 1.5);

    rndArr[4 * i] = Math.min(1, 0.9 * Math.hypot(px, py * aspect) + 0.4 * seededRandom());
    rndArr[4 * i + 1] = seededRandom();
    rndArr[4 * i + 2] = seededRandom();
    rndArr[4 * i + 3] = seededRandom();
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  particleGeo.setAttribute("aStart", new THREE.BufferAttribute(startArr, 3));
  particleGeo.setAttribute("aRnd", new THREE.BufferAttribute(rndArr, 4));

  const accentColor = new THREE.Color("#cfef8c");
  const particleUniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uDissolve: { value: 0 },
    uScan: { value: 99 },
    uDim: { value: 1 },
    uSize: { value: Math.max(1.6, 1.9 * ptScale) },
    uPR: { value: pr },
    uColor: { value: new THREE.Color("#f3f2ec") },
    uAccent: { value: accentColor },
  };

  const blendOpts = {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  };

  const particleMat = new THREE.ShaderMaterial({
    vertexShader: VERT_PARTICLES,
    fragmentShader: FRAG_PARTICLES,
    uniforms: particleUniforms,
    ...blendOpts,
  });

  const group = new THREE.Group();
  group.position.set(offsetX, offsetY, 0);
  group.add(new THREE.Points(particleGeo, particleMat));
  scene.add(group);

  const dustCount = isSmall ? 350 : 800;
  const dustPos = new Float32Array(3 * dustCount);
  const dustRnd = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[3 * i] = (seededRandom() - 0.5) * 14;
    dustPos[3 * i + 1] = (seededRandom() - 0.5) * 8;
    dustPos[3 * i + 2] = -(10 * seededRandom()) + 1;
    dustRnd[i] = seededRandom();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute("aRnd", new THREE.BufferAttribute(dustRnd, 1));

  const dustUniforms = {
    uTime: particleUniforms.uTime,
    uPR: particleUniforms.uPR,
    uAlpha: { value: 0 },
    uAccent: { value: accentColor },
  };
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: VERT_DUST,
    fragmentShader: FRAG_DUST,
    uniforms: dustUniforms,
    ...blendOpts,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  scene.add(dustPoints);

  const scanUniforms = {
    uAlpha: { value: 0 },
    uAccent: { value: accentColor },
  };
  const scanGeo = new THREE.PlaneGeometry(1.5 * widthWorld, 0.09 * heightWorld);
  const scanMat = new THREE.ShaderMaterial({
    vertexShader:
      "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: FRAG_SCAN,
    uniforms: scanUniforms,
    ...blendOpts,
  });
  const scanMesh = new THREE.Mesh(scanGeo, scanMat);
  group.add(scanMesh);

  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointerMove = (e: PointerEvent) => {
    mouse.x = e.clientX / window.innerWidth - 0.5;
    mouse.y = e.clientY / window.innerHeight - 0.5;
  };
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("resize", onResize);

  const t0 = performance.now();
  return {
    update(progress: number, scanProgress: number, dissolve: number, dim: number) {
      const elapsed = (performance.now() - t0) / 1000;
      particleUniforms.uTime.value = elapsed;
      particleUniforms.uProgress.value = progress;
      particleUniforms.uDissolve.value = dissolve;
      particleUniforms.uDim.value = dim;

      const scanY = heightWorld / 2 + 0.15 * heightWorld - scanProgress * heightWorld * 1.3;
      particleUniforms.uScan.value = scanProgress > 0 && scanProgress < 1 ? scanY : 99;
      scanMesh.position.y = scanY;
      scanUniforms.uAlpha.value = Math.sin(Math.PI * Math.min(1, scanProgress)) * (1 - dissolve);
      dustUniforms.uAlpha.value = Math.min(1, 2 * progress) * (1 - 0.6 * dissolve);

      const easeIn = 1 - Math.pow(1 - Math.min(1, 1.05 * progress), 3);
      mouse.sx += (mouse.x - mouse.sx) * 0.06;
      mouse.sy += (mouse.y - mouse.sy) * 0.06;
      const sway = 1 - 0.9 * easeIn;
      group.rotation.y = (1 - easeIn) * 0.9 + 0.35 * mouse.sx * sway;
      group.rotation.x = -((1 - easeIn) * 0.25) + 0.2 * mouse.sy * sway;
      dustPoints.rotation.y = 0.03 * elapsed + 0.15 * mouse.sx;
      dustPoints.rotation.x = 0.08 * mouse.sy;
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      [particleGeo, particleMat, dustGeo, dustMat, scanGeo, scanMat].forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}

const triggerIntroStart = () => {
  try {
    sessionStorage.setItem("qt-intro", "1");
  } catch {}
  document.documentElement.classList.add("intro-go");
  window.dispatchEvent(new Event("s3de:intro"));
};

export function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const current = { x: target.x, y: target.y };
    let hovered = false;
    let rafId = 0;
    let prevTime = performance.now();

    const onPointerMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      const el = e.target as Element | null;
      hovered = !!el?.closest("a, button, [data-cursor], input, select, textarea, label");
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prevTime) / 1000);
      prevTime = now;
      const alpha = 1 - Math.pow(1 - 0.18, 60 * dt);
      current.x += (target.x - current.x) * alpha;
      current.y += (target.y - current.y) * alpha;

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) scale(${
          hovered ? 1.9 : 1
        })`;
      }
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.classList.remove("has-cursor");
    };
  }, []);

  return (
    <>
      <div ref={ringRef} className="cur cur--ring" aria-hidden="true" />
      <div ref={dotRef} className="cur cur--dot" aria-hidden="true" />
    </>
  );
}

export function Loader() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const hashRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let seenBefore = false;
    try {
      seenBefore = sessionStorage.getItem("qt-intro") === "1";
    } catch {}

    if (seenBefore || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => {
        setDone(true);
        triggerIntroStart();
      });
      return () => cancelAnimationFrame(id);
    }

    const root = rootRef.current;
    if (!root) return;
    const svgLogo = root.querySelector(".loader__logo") as SVGSVGElement | null;
    const labels = ["Verifying Robinhood 4663 state", "ML-DSA-44 integrity verified"];
    if (labelRef.current) labelRef.current.textContent = labels[0];

    let pageLoaded = document.readyState === "complete";
    const onLoad = () => {
      pageLoaded = true;
    };
    window.addEventListener("load", onLoad);

    let glScene: Awaited<ReturnType<typeof createLoaderScene>> | null = null;
    let rafId = 0;
    let alive = true;
    let startTime = 0;
    let finishTime = 0;
    let lastHashTime = 0;
    let disposeTimeout = 0;

    const animate = (now: number) => {
      const elapsed = Math.max(0, (now - startTime) / 1000);
      if (elapsed >= 2.6 && (pageLoaded || elapsed >= 5.5) && !finishTime) {
        finishTime = now;
        window.setTimeout(() => {
          setDone(true);
          triggerIntroStart();
        }, 150);
      }

      const dissolve = finishTime ? Math.min(1, (now - finishTime) / 1000 / 0.7) : 0;
      const pct = Math.round(
        (1 - Math.pow(1 - Math.min(elapsed / 2.6, pageLoaded ? 1 : 0.92), 2)) * 100
      );

      if (pctRef.current) {
        pctRef.current.textContent = `${String(pct).padStart(2, "0")} %`;
      }
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${pct / 100})`;
      }

      if (elapsed >= 2.2) {
        root.classList.add("is-formed");
        if (labelRef.current) labelRef.current.textContent = labels[1];
      } else if (hashRef.current && now - lastHashTime > 55) {
        lastHashTime = now;
        let hex = "0x";
        for (let i = 0; i < 24; i++) {
          hex += "0123456789abcdef"[(16 * Math.random()) | 0];
        }
        hashRef.current.textContent = hex;
      }

      glScene?.update(
        Math.min(1, elapsed / 2.0),
        Math.min(1, Math.max(0, (elapsed - 1.6) / 0.9)),
        dissolve,
        1 - 0.6 * Math.min(1, Math.max(0, (elapsed - 2.2) / 0.4))
      );

      if (dissolve < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        disposeTimeout = window.setTimeout(() => glScene?.dispose(), 600);
      }
    };

    const startLoop = () => {
      if (alive) {
        startTime = performance.now();
        rafId = requestAnimationFrame(animate);
      }
    };

    if (svgLogo && canvasRef.current) {
      createLoaderScene(canvasRef.current, svgLogo)
        .then((sc) => {
          if (!alive) return sc.dispose();
          glScene = sc;
          root.classList.add("is-particles");
          startLoop();
        })
        .catch(() => {
          root.classList.add("is-fallback");
          startLoop();
        });
    } else {
      root.classList.add("is-fallback");
      startLoop();
    }

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      clearTimeout(disposeTimeout);
      window.removeEventListener("load", onLoad);
      glScene?.dispose();
    };
  }, []);

  return (
    <div ref={rootRef} className={`loader${done ? " is-done" : ""}`} aria-hidden="true">
      <canvas ref={canvasRef} className="loader__gl" />
      <QTimelineStackedMark className="loader__logo" />
      <span className="loader__meta mono">
        <span ref={labelRef} className="loader__label" />
        <span ref={hashRef} className="loader__hash" />
      </span>
      <span ref={pctRef} className="loader__n mono">
        00 %
      </span>
      <span ref={barRef} className="loader__bar" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}
