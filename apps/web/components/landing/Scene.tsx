"use client";

import React, { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

type Formation = "cloud" | "mono" | "chain" | "ring";

const hash1 = (seed: number) => {
  const x = 43758.5453 * Math.sin(127.1 * seed + 311.7);
  return x - Math.floor(x);
};

const smoothstep01 = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function computeFormation(
  formation: Formation,
  index: number,
  outPos: THREE.Vector3,
  outEuler: THREE.Euler,
  time: number
) {
  switch (formation) {
    case "cloud": {
      const theta = hash1(index) * Math.PI * 2;
      const phi = Math.acos(2 * hash1(index + 50) - 1);
      const radius = 6 + 5 * hash1(index + 99);
      outPos.set(
        radius * Math.sin(phi) * Math.cos(theta) * 1.2,
        radius * Math.sin(phi) * Math.sin(theta) * 0.65,
        radius * Math.cos(phi) * 0.45 - 4
      );
      outEuler.set(
        6 * hash1(index + 3) + 0.2 * time,
        6 * hash1(index + 7) + 0.15 * time,
        6 * hash1(index + 11)
      );
      return;
    }
    case "mono": {
      const ix = (index % 3) - 1;
      const iy = (Math.floor(index / 3) % 3) - 1;
      const iz = Math.floor(index / 9) - 1;
      outPos.set(1.06 * ix, 1.06 * iy, 1.06 * iz);
      outEuler.set(0, 0, 0);
      return;
    }
    case "chain": {
      const offset = index - 13;
      const polarity = index % 2 === 0 ? 1 : -1;
      outPos.set(
        1.5 * offset,
        polarity * 1.15 + 0.55 * Math.sin(0.45 * offset + 0.6 * time),
        polarity * 0.45 + 0.8 * Math.cos(0.35 * offset + 0.4 * time)
      );
      outEuler.set(0.22 * offset + 0.25 * time, 0.12 * offset, Math.PI / 4);
      return;
    }
    case "ring": {
      const angle = (index / 27) * Math.PI * 2 + 0.08 * time;
      outPos.set(
        5.2 * Math.cos(angle),
        5.2 * Math.sin(angle),
        0.35 * Math.sin(3 * angle + 0.5 * time)
      );
      outEuler.set(0.3, 0.2, angle);
      return;
    }
  }
}

function computeGroupPose(formation: Formation, isMobile: boolean) {
  const desktop = +!isMobile;
  if (formation === "mono" || formation === "cloud") {
    return {
      x: 3.2 * desktop,
      y: 2.7 * +isMobile,
      z: -1,
      rx: -0.35,
      rz: 0,
      s: isMobile ? 0.62 : 1.25,
    };
  }
  if (formation === "chain") {
    return {
      x: 0,
      y: isMobile ? 0.5 : -0.4,
      z: -1,
      rx: 0.1,
      rz: -0.32,
      s: isMobile ? 0.55 : 0.8,
    };
  }
  return {
    x: 0,
    y: 0,
    z: -3,
    rx: 1.05,
    rz: 0,
    s: isMobile ? 0.7 : 1,
  };
}

const GRAIN_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    precision mediump float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= smoothstep(0.96, 0.3, d);
      c.rgb += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

const WAVE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uScroll;
  uniform float uPolarity;
  uniform float uPixelRatio;
  uniform vec2 uMouse;

  attribute float aSeed;

  varying float vCrest;
  varying float vFade;
  varying float vBifurcation;

  void main() {
    vec3 pos = position;

    float splitMask = smoothstep(-2.4, 2.2, pos.x);
    float waveA = sin(pos.x * 0.52 - uTime * 1.15 + pos.z * 0.35) * 0.55;
    float waveB = cos(pos.x * 0.95 + uTime * 0.85 - pos.z * 0.65) * 0.25;
    float waveC = sin((pos.x + pos.z) * 1.45 - uTime * 1.55) * 0.1;
    float harmonic = waveA + waveB + waveC;

    float midExpand = sin(clamp(uScroll, 0.0, 1.0) * 3.14159265);
    float resolveFlatten = 1.0 - smoothstep(0.76, 0.98, uScroll) * 0.72;

    float branchOffset = uPolarity * splitMask * (0.75 + midExpand * 1.05) * resolveFlatten;
    float elevation = (harmonic * (0.4 + splitMask * 0.7) * resolveFlatten) + branchOffset;

    float distMouse = length(pos.xz - uMouse * vec2(7.5, 4.5));
    float ripple = exp(-distMouse * 0.42) * sin(distMouse * 2.2 - uTime * 3.2) * 0.4;
    pos.y += elevation + ripple;
    pos.z += sin(pos.x * 0.4 - uTime * 0.7) * 0.14 * splitMask;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float crestEnergy = clamp(abs(harmonic) * 0.75 + splitMask * 0.35, 0.0, 1.0);
    float baseSize = mix(1.3, 2.8, crestEnergy) + aSeed * 0.65;
    gl_PointSize = baseSize * uPixelRatio * (11.0 / max(-mvPosition.z, 1.5));

    float xFade = smoothstep(13.8, 7.5, abs(pos.x));
    float zFade = smoothstep(8.2, 2.5, abs(pos.z));
    vFade = xFade * zFade;
    vCrest = crestEnergy;
    vBifurcation = splitMask;
  }
`;

const WAVE_FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec3 uColorLow;
  uniform vec3 uColorHigh;

  varying float vCrest;
  varying float vFade;
  varying float vBifurcation;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float alpha = smoothstep(0.5, 0.08, d) * vFade * mix(0.22, 0.72, vCrest);
    vec3 col = mix(uColorLow, uColorHigh, smoothstep(0.15, 0.9, vCrest * 0.8 + vBifurcation * 0.35));
    gl_FragColor = vec4(col, alpha);
  }
`;

function createWaveGeometry(cols: number, rows: number, width: number, depth: number) {
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1) - 0.5;
    const z = v * depth;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1) - 0.5;
      const x = u * width;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = 0;
      positions[idx * 3 + 2] = z;
      seeds[idx] = ((Math.sin(idx * 12.9898) * 43758.5453) % 1 + 1) % 1;
      idx++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  return geo;
}

export default function Scene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const dimSections = Array.from(document.querySelectorAll<HTMLElement>("[data-dim]"));
    el.style.opacity = "1";
    if (!dimSections.length) return;

    const getDimValue = (target: Element) => {
      const val = parseFloat((target as HTMLElement).dataset.dim || "");
      return Number.isFinite(val) ? val : 0.24;
    };

    const activeSet = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) =>
          entry.isIntersecting ? activeSet.add(entry.target) : activeSet.delete(entry.target)
        );
        el.style.opacity = String(
          activeSet.size ? Math.min(...Array.from(activeSet, getDimValue)) : 1
        );
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );

    dimSections.forEach((sec) => observer.observe(sec));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let isMobile = window.innerWidth < 820;
    const getPixelRatio = () => Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);

    renderer.setPixelRatio(getPixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080a09);
    scene.fog = new THREE.FogExp2(0x080a09, 0.042);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 15);

    const keyLight = new THREE.DirectionalLight(0xf3f2ec, 1.6);
    keyLight.position.set(5, 6, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xcfef8c, 1.05);
    rimLight.position.set(-6, -2, -4);
    scene.add(rimLight);

    // GLSL Twin-Timeline Probability Wave Field (lower horizon)
    const fieldGroup = new THREE.Group();
    fieldGroup.position.set(0.65, -2.35, -3.5);
    fieldGroup.rotation.set(0.22, -0.14, 0);
    scene.add(fieldGroup);

    const cols = isMobile ? 80 : 128;
    const rows = isMobile ? 40 : 64;
    const waveGeo = createWaveGeometry(cols, rows, 26, 15);

    const yesMat = new THREE.ShaderMaterial({
      vertexShader: WAVE_VERTEX_SHADER,
      fragmentShader: WAVE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uPolarity: { value: 1.0 },
        uPixelRatio: { value: getPixelRatio() },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uColorLow: { value: new THREE.Color(0x376d4c) },
        uColorHigh: { value: new THREE.Color(0xcfef8c) },
      },
    });

    const noMat = new THREE.ShaderMaterial({
      vertexShader: WAVE_VERTEX_SHADER,
      fragmentShader: WAVE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uPolarity: { value: -1.0 },
        uPixelRatio: { value: getPixelRatio() },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uColorLow: { value: new THREE.Color(0x3a433d) },
        uColorHigh: { value: new THREE.Color(0xf3f2ec) },
      },
    });

    const yesField = new THREE.Points(waveGeo, yesMat);
    const noField = new THREE.Points(waveGeo, noMat);
    fieldGroup.add(yesField, noField);

    // 27 Rounded Obsidian Cubes (exact ERESTYRA cloud -> mono -> chain -> ring choreography)
    const group = new THREE.Group();
    scene.add(group);

    const cubeGeo = new RoundedBoxGeometry(0.92, 0.92, 0.92, 3, 0.06);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.94, 0.94, 0.94));
    const cubeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0e0e0e,
      metalness: 0.85,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.15,
    });
    const yesEdgeMat = new THREE.LineBasicMaterial({
      color: 0xcfef8c,
      transparent: true,
      opacity: 0.6,
    });
    const noEdgeMat = new THREE.LineBasicMaterial({
      color: 0xf3f2ec,
      transparent: true,
      opacity: 0.4,
    });

    const cubes: THREE.Mesh[] = [];
    for (let i = 0; i < 27; i++) {
      const mesh = new THREE.Mesh(cubeGeo, cubeMat);
      mesh.add(new THREE.LineSegments(edgeGeo, i % 2 === 0 ? yesEdgeMat : noEdgeMat));
      group.add(mesh);
      cubes.push(mesh);
    }

    const lineCoords = new Float32Array(84);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(lineCoords, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xcfef8c,
      transparent: true,
      opacity: 0,
    });
    const connectorLine = new THREE.Line(lineGeo, lineMat);
    group.add(connectorLine);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.36,
      0.45,
      0.8
    );
    bloomPass.enabled = !isMobile;
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    const grainPass = new ShaderPass(GRAIN_SHADER);
    composer.addPass(grainPass);

    const states = cubes.map(() => ({ p: new THREE.Vector3(), r: new THREE.Euler() }));
    const tmpPosA = new THREE.Vector3();
    const tmpPosB = new THREE.Vector3();
    const tmpEulerA = new THREE.Euler();
    const tmpEulerB = new THREE.Euler();
    const tmpQuatA = new THREE.Quaternion();
    const tmpQuatB = new THREE.Quaternion();

    cubes.forEach((_, idx) => {
      computeFormation("cloud", idx, states[idx].p, states[idx].r, 0);
      cubes[idx].position.copy(states[idx].p);
      cubes[idx].rotation.copy(states[idx].r);
    });

    const pose = { x: 3.2, y: 0, z: -1, rx: -0.35, rz: 0, s: 1.25 };
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let smoothScroll = 0;
    let spinY = 0;
    let elapsedTime = 0;
    let lastNow = performance.now();
    let introProgress = reducedMotion ? 1 : 0;
    const docEl = document.documentElement;
    let introStarted =
      reducedMotion ||
      docEl.classList.contains("intro-go") ||
      !document.querySelector(".loader");

    const onIntro = () => {
      introStarted = true;
    };
    window.addEventListener("s3de:intro", onIntro);
    const introFallbackTimeout = window.setTimeout(onIntro, 9000);

    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const onResize = () => {
      isMobile = window.innerWidth < 820;
      const pr = getPixelRatio();
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      bloomPass.enabled = !isMobile;
      yesMat.uniforms.uPixelRatio.value = pr;
      noMat.uniforms.uPixelRatio.value = pr;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize);

    let rafId = 0;
    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastNow) * 0.001, 0.05);
      lastNow = now;
      if (document.hidden) return;

      const speedMul = reducedMotion ? 0.15 : 1;
      elapsedTime += dt * speedMul;

      const lerpFast = 1 - Math.pow(0.925, 60 * dt);
      const lerpSlow = 1 - Math.pow(0.96, 60 * dt);
      if (introStarted) {
        introProgress = Math.min(1, introProgress + dt / 3);
      }

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const rawScroll = maxScroll > 0 ? window.scrollY / maxScroll : 0;
      smoothScroll += (rawScroll - smoothScroll) * lerpFast;

      const stops: [number, Formation][] = [
        [0, "mono"],
        [0.14, "mono"],
        [0.34, "chain"],
        [0.5, "chain"],
        [0.68, "ring"],
        [0.86, "ring"],
        [1, "mono"],
      ];
      let formA: Formation = "mono";
      let formB: Formation = "mono";
      let blend = 0;
      for (let idx = 0; idx < stops.length - 1; idx++) {
        const [s0, f0] = stops[idx];
        const [s1, f1] = stops[idx + 1];
        if (smoothScroll <= s1) {
          formA = f0;
          formB = f1;
          blend = clamp01((smoothScroll - s0) / (s1 - s0 || 1));
          break;
        }
      }

      const introSmooth = smoothstep01(introProgress);
      for (let i = 0; i < 27; i++) {
        const normIdx = i / 26;
        const morphT = smoothstep01(clamp01((blend - 0.3 * normIdx) / 0.7));
        computeFormation(formA, i, tmpPosA, tmpEulerA, elapsedTime);
        computeFormation(formB, i, tmpPosB, tmpEulerB, elapsedTime);
        tmpPosA.lerp(tmpPosB, morphT);
        tmpQuatA.setFromEuler(tmpEulerA).slerp(tmpQuatB.setFromEuler(tmpEulerB), morphT);

        const introT = smoothstep01(clamp01((introSmooth - 0.45 * normIdx) / 0.55));
        if (introT < 1) {
          computeFormation("cloud", i, tmpPosB, tmpEulerB, elapsedTime);
          tmpPosA.lerp(tmpPosB, 1 - introT);
          tmpQuatA.slerp(tmpQuatB.setFromEuler(tmpEulerB), 1 - introT);
        }

        const st = states[i];
        st.p.lerp(tmpPosA, lerpFast);
        cubes[i].quaternion.slerp(tmpQuatA, lerpFast);
        cubes[i].position.copy(st.p);
        lineCoords[3 * i] = st.p.x;
        lineCoords[3 * i + 1] = st.p.y;
        lineCoords[3 * i + 2] = st.p.z;
      }

      lineCoords[81] = lineCoords[0];
      lineCoords[82] = lineCoords[1];
      lineCoords[83] = lineCoords[2];
      lineGeo.attributes.position.needsUpdate = true;

      const weightOf = (f: Formation) => (formA === f ? 1 - blend : 0) + (formB === f ? blend : 0);
      const lineWeight = Math.max(weightOf("chain"), weightOf("ring")) * introSmooth;
      lineGeo.setDrawRange(0, weightOf("ring") > 0.5 ? 28 : 27);
      lineMat.opacity += (0.35 * lineWeight - lineMat.opacity) * lerpFast;

      const poseA = computeGroupPose(formA, isMobile);
      const poseB = computeGroupPose(formB, isMobile);
      const poseBlend = smoothstep01(blend);
      (Object.keys(pose) as (keyof typeof pose)[]).forEach((k) => {
        const targetVal = poseA[k] + (poseB[k] - poseA[k]) * poseBlend;
        pose[k] += (targetVal - pose[k]) * lerpSlow;
      });

      pointer.x += (pointer.tx - pointer.x) * lerpFast;
      pointer.y += (pointer.ty - pointer.y) * lerpFast;
      spinY += 0.12 * dt * speedMul;

      group.position.set(pose.x, pose.y, pose.z);
      group.scale.setScalar(pose.s);
      group.rotation.set(pose.rx + 0.18 * pointer.y, spinY + 0.35 * pointer.x, pose.rz);

      yesMat.uniforms.uTime.value = elapsedTime;
      noMat.uniforms.uTime.value = elapsedTime;
      yesMat.uniforms.uScroll.value = smoothScroll;
      noMat.uniforms.uScroll.value = smoothScroll;
      yesMat.uniforms.uMouse.value.set(pointer.x, -pointer.y);
      noMat.uniforms.uMouse.value.set(pointer.x, -pointer.y);

      camera.position.x = 0.6 * pointer.x;
      camera.position.y = -(0.4 * pointer.y);
      camera.lookAt(0, 0, 0);

      grainPass.uniforms.uTime.value = elapsedTime;
      composer.render();
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(introFallbackTimeout);
      window.removeEventListener("s3de:intro", onIntro);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      composer.dispose();
      waveGeo.dispose();
      cubeGeo.dispose();
      edgeGeo.dispose();
      lineGeo.dispose();
      yesMat.dispose();
      noMat.dispose();
      cubeMat.dispose();
      yesEdgeMat.dispose();
      noEdgeMat.dispose();
      lineMat.dispose();
      envTex.dispose();
      roomEnv.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={containerRef} className="scene" aria-hidden="true" />;
}
