import React, { useMemo } from "react";
import * as THREE from "three";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { SceneProps, relLines, useTL } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog, rand } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Counter, Stamp, Words } from "../components/Type";
import { Icon, IconName } from "../components/Icons";
import { CamRig, GlowPoints, LightTrails, Phone, QR_TEXT, RupeeField, Stage, drawPayScreen, qrMatrix, useCanvasTexture } from "../three/kit";
import india from "../data/india_night.json";

/*
 * COLD OPEN — timing contract with music/score.py (cold_open): every beat below is derived from the
 * narration lines the same way the score derives its hits, so picture and sound land together.
 *   mapIn   = c0_01.at - 8        clock dives into the night map (zoom sound)
 *   countAt = c0_01 @ 0.45        the counter starts rolling
 *   vig[k]  = c0_02.at + k·len/3  whip into each everyday payment
 *   paidAt  = c0_03 @ 0.72        payment lands, money bursts out
 *   crackAt = c0_05.at            FREE cracks and shatters
 *   whoAt   = c0_07 @ 0.45        WHO? slams in
 */

const c01 = (x: number) => Math.max(0, Math.min(1, x));

/* ---------------------------------------------------------------- pre-roll: the clock */

const PreRoll: React.FC<{ end: number }> = ({ end }) => {
  const frame = useCurrentFrame();
  const tick = Math.floor(frame / 15);
  const dive = prog(frame, end - 12, 12, ease.in);
  const scale = interpolate(frame, [0, end - 12], [0.92, 1.06], clamp) * (1 + dive * 7);
  const rings = [tick - 1, tick].filter((k) => k >= 0);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: prog(frame, 0, 8) * (1 - prog(frame, end - 5, 5)) }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 50%, rgba(255,165,58,0.10) 0%, rgba(4,6,11,0) 35%)" }} />
      <svg width={900} height={900} viewBox="-450 -450 900 900" style={{ transform: `scale(${scale})`, filter: dive > 0.05 ? `blur(${dive * 10}px)` : undefined }}>
        {rings.map((k) => {
          const age = frame - k * 15;
          return <circle key={k} r={104 + age * 9} fill="none" stroke={C.amber} strokeWidth={2} opacity={Math.max(0, 0.45 * (1 - age / 22))} />;
        })}
        <circle r={100} fill="none" stroke="rgba(242,239,232,0.28)" strokeWidth={2} />
        {Array.from({ length: 60 }).map((_, i) => (
          <line key={i} x1={0} y1={-100} x2={0} y2={i % 5 === 0 ? -86 : -94} stroke="rgba(242,239,232,0.45)" strokeWidth={i % 5 === 0 ? 3 : 1} transform={`rotate(${i * 6})`} />
        ))}
        <g transform={`rotate(${tick * 6})`} style={{ filter: "drop-shadow(0 0 6px rgba(255,165,58,0.9))" }}>
          <line x1={0} y1={14} x2={0} y2={-92} stroke={C.amber} strokeWidth={3} />
          <circle cx={0} cy={-92} r={3.5} fill="#fff" />
        </g>
        <circle r={5} fill={C.amber} />
      </svg>
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------- A: the night map of payments */

const VB_W = india.viewBox[2];
const VB_H = india.viewBox[3];
const MAP_W = 20;
const MAP_H = (MAP_W * VB_H) / VB_W;
const CITIES = india.cities;
const N_ARCS = 240;
const SEGS = 24;
const TAIL = 14;
const world = (c: { x: number; y: number }): [number, number, number] => [(c.x / VB_W - 0.5) * MAP_W, (0.5 - c.y / VB_H) * MAP_H, 0];

type Arc = { start: number; dur: number; p0: number[]; p1: number[]; p2: number[] };
const bez = (a: Arc, u: number, out: Float32Array, o: number) => {
  const v = 1 - u;
  for (let k = 0; k < 3; k++) out[o + k] = v * v * a.p0[k] + 2 * v * u * a.p1[k] + u * u * a.p2[k];
};

const buildArcs = (len: number): Arc[] => {
  const total = CITIES.reduce((s, c) => s + c.w, 0);
  const pick = (r: number) => {
    let acc = 0;
    for (let i = 0; i < CITIES.length; i++) {
      acc += CITIES[i].w / total;
      if (r <= acc) return i;
    }
    return CITIES.length - 1;
  };
  return Array.from({ length: N_ARCS }, (_, k) => {
    const ai = pick(rand(k * 3.1 + 1));
    let bi = pick(rand(k * 5.7 + 2));
    if (bi === ai) bi = (ai + 7) % CITIES.length;
    const p0 = world(CITIES[ai]);
    const p2 = world(CITIES[bi]);
    const d = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
    const h = 0.16 * d + 0.35;
    return {
      start: Math.round(len * 0.8 * Math.pow(k / N_ARCS, 0.62)),
      dur: 16 + Math.round(rand(k * 9.3) * 14),
      p0,
      p1: [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2, 2 * h],
      p2,
    };
  });
};

const drawNightMap = (ctx: CanvasRenderingContext2D) => {
  const W = ctx.canvas.width;
  const s = W / VB_W;
  const path = new Path2D(india.path);
  ctx.clearRect(0, 0, W, ctx.canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, VB_H);
  g.addColorStop(0, "#0a1a29");
  g.addColorStop(1, "#06111c");
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.lineJoin = "round";
  for (const [w, a] of [[12, 0.04], [7, 0.08], [3.5, 0.2], [1.3, 0.85]] as const) {
    ctx.strokeStyle = `rgba(46,230,214,${a})`;
    ctx.lineWidth = w;
    ctx.stroke(path);
  }
  // city lights: dense around metros, a scatter of towns everywhere inside the border
  const total = CITIES.reduce((sum, c) => sum + c.w, 0);
  const dot = (x: number, y: number, r: number, a: number, col = "255,196,120") => {
    if (!ctx.isPointInPath(path, x * s, y * s)) return;
    ctx.fillStyle = `rgba(${col},${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < 7000; i++) {
    let r = rand(i * 1.7 + 0.3) * total;
    let c = CITIES[0];
    for (const cc of CITIES) {
      r -= cc.w;
      if (r <= 0) {
        c = cc;
        break;
      }
    }
    const u1 = Math.max(1e-6, rand(i * 2.3 + 0.7));
    const u2 = rand(i * 3.9 + 0.1);
    const rad = Math.sqrt(-2 * Math.log(u1)) * (5 + c.w * 1.8);
    dot(c.x + Math.cos(2 * Math.PI * u2) * rad, c.y + Math.sin(2 * Math.PI * u2) * rad, 0.35 + rand(i * 5.1) * 0.7, 0.25 + rand(i * 6.3) * 0.5);
  }
  for (let i = 0; i < 4500; i++) dot(rand(i * 7.7 + 0.2) * VB_W, rand(i * 8.9 + 0.4) * VB_H, 0.3 + rand(i) * 0.4, 0.12 + rand(i * 2.2) * 0.22);
  for (const c of CITIES) {
    const rg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 5 + c.w * 1.6);
    rg.addColorStop(0, "rgba(255,226,170,0.9)");
    rg.addColorStop(0.35, "rgba(255,170,80,0.35)");
    rg.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(c.x - 30, c.y - 30, 60, 60);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

const NightMapScene: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const mapTex = useCanvasTexture(2048, Math.round((2048 * VB_H) / VB_W), drawNightMap, []);
  const gridTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "rgba(46,230,214,0.09)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 14);
    return t;
  }, []);
  const arcs = useMemo(() => buildArcs(len), [len]);
  const trailPos = useMemo(() => {
    const p = new Float32Array(N_ARCS * SEGS * 6);
    const tmp = new Float32Array(3);
    arcs.forEach((a, k) => {
      for (let s = 0; s < SEGS; s++) {
        bez(a, s / SEGS, tmp, 0);
        p.set(tmp, (k * SEGS + s) * 6);
        bez(a, (s + 1) / SEGS, tmp, 0);
        p.set(tmp, (k * SEGS + s) * 6 + 3);
      }
    });
    return p;
  }, [arcs]);
  const trailCol = useMemo(() => new Float32Array(N_ARCS * SEGS * 6), []);
  const NP = N_ARCS * TAIL + N_ARCS + CITIES.length;
  const buf = useMemo(() => ({ pos: new Float32Array(NP * 3), size: new Float32Array(NP), alpha: new Float32Array(NP), col: new Float32Array(NP * 3) }), [NP]);

  // ---- per-frame state
  const f = frame;
  for (let k = 0; k < N_ARCS; k++) {
    const a = arcs[k];
    const head = (f - a.start) / a.dur;
    for (let s = 0; s < SEGS; s++) {
      const ts = (s + 0.5) / SEGS;
      let b = 0;
      if (head >= ts) {
        const age = f - (a.start + ts * a.dur);
        b = 0.6 * Math.exp(-age / 9) + 0.13;
      }
      const o = (k * SEGS + s) * 6;
      trailCol[o] = trailCol[o + 3] = 0.18 * b + 0.25 * b * b;
      trailCol[o + 1] = trailCol[o + 4] = 0.9 * b;
      trailCol[o + 2] = trailCol[o + 5] = 0.84 * b;
    }
    for (let j = 0; j < TAIL; j++) {
      const i = k * TAIL + j;
      const u = head - j * 0.045;
      if (u < 0 || u > 1) {
        buf.alpha[i] = 0;
        continue;
      }
      bez(a, u, buf.pos, i * 3);
      buf.size[i] = 0.34 - j * 0.019;
      buf.alpha[i] = Math.pow(1 - j / TAIL, 1.6);
      const w = j < 2 ? 1 : 0;
      buf.col[i * 3] = 0.25 + 0.75 * w;
      buf.col[i * 3 + 1] = 0.95;
      buf.col[i * 3 + 2] = 0.88 + 0.1 * w;
    }
    const li = N_ARCS * TAIL + k;
    const age = f - (a.start + a.dur);
    if (age >= 0 && age < 16) {
      buf.pos.set(a.p2, li * 3);
      buf.size[li] = 0.45 + age * 0.1;
      buf.alpha[li] = Math.pow(1 - age / 16, 2) * 0.9;
      buf.col.set([1, 0.78, 0.48], li * 3);
    } else buf.alpha[li] = 0;
  }
  CITIES.forEach((c, i) => {
    const ci = N_ARCS * TAIL + N_ARCS + i;
    buf.pos.set(world(c), ci * 3);
    buf.size[ci] = 0.22 + c.w * 0.05;
    buf.alpha[ci] = 0.55 + 0.3 * Math.sin(f * 0.12 + i * 1.7);
    buf.col.set([1, 0.66, 0.3], ci * 3);
  });

  // ---- camera: low over central India, crane up and back to reveal the whole country
  const R = keys(f, [[0, 3.0], [len, 29]], ease.cam);
  const tilt = keys(f, [[0, 1.08], [len, 0.44]], ease.cam);
  const az = keys(f, [[0, -0.55], [len, 0.06]], ease.cam);
  const tx = keys(f, [[0, -2.4], [len, -6.2]], ease.cam); // ends with India right of centre, the counter on the left
  const ty = keys(f, [[0, -0.9], [len, -0.2]], ease.cam);
  const pos: [number, number, number] = [tx + R * Math.sin(tilt) * Math.sin(az), ty - R * Math.sin(tilt) * Math.cos(az), R * Math.cos(tilt)];
  return (
    <>
      <CamRig pos={pos} target={[tx, ty, 0]} fov={40} />
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[120, 120]} />
        <meshBasicMaterial map={gridTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[MAP_W, MAP_H]} />
        <meshBasicMaterial map={mapTex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <LightTrails positions={trailPos} colors={trailCol} />
      <GlowPoints positions={buf.pos} sizes={buf.size} alphas={buf.alpha} colors={buf.col} fov={40} />
    </>
  );
};

const NightMap: React.FC<{ len: number; countAt: number; text: string }> = ({ len, countAt, text }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const inP = prog(frame, 0, 10, ease.out);
  const labelP = prog(frame, countAt - 4, 12, ease.out);
  return (
    <AbsoluteFill style={{ opacity: inP }}>
      <Backdrop hue="teal" light={0.55} />
      <Stage env={false} fov={40}>
        <NightMapScene len={len} />
      </Stage>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 70% at 50% 45%, rgba(4,6,11,0) 50%, rgba(4,6,11,0.75) 100%)" }} />
      <div style={{ position: "absolute", left: 130, top: 300, opacity: labelP, transform: `translateY(${(1 - labelP) * 30}px)` }}>
        <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.34em", color: C.teal, marginBottom: 10 }}>{t("UPI · हर दिन", "UPI PAYMENTS · EVERY DAY")}</div>
        <Counter to={800000000} start={countAt} dur={26} size={136} color={C.ink} />
        <div style={{ width: 380 * prog(frame, countAt + 4, 20), height: 2, marginTop: 14, background: `linear-gradient(90deg, ${C.teal}, rgba(46,230,214,0))` }} />
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(rgba(4,6,11,0) 62%, rgba(4,6,11,0.9) 88%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
        <Words text={text} start={10} size={86} font={F.hiDisplay} weight={500} stagger={5} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------ B: three everyday payments */

const DIGITS = Array.from({ length: 30 }, (_, i) => i % 10);
/** Slot-machine digits that roll into place left to right. */
const SlotText: React.FC<{ text: string; start: number; size: number; color: string }> = ({ text, start, size, color }) => {
  const frame = useCurrentFrame();
  let di = 0;
  return (
    <div style={{ fontFamily: F.hiDisplay, fontSize: size, color, lineHeight: 1.05, display: "flex", fontWeight: 500, textShadow: `0 0 40px ${color}55` }}>
      {text.split("").map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} style={{ whiteSpace: "pre" }}>{ch}</span>;
        const d = Number(ch);
        const p = prog(frame, start + di++ * 2, 16, ease.out);
        const idx = p * (20 + d);
        return (
          <span key={i} style={{ display: "inline-block", height: "1.05em", overflow: "hidden" }}>
            <span style={{ display: "block", transform: `translateY(${-idx * 1.05}em)` }}>
              {DIGITS.map((n, k) => (
                <span key={k} style={{ display: "block", height: "1.05em" }}>
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
};

const Rays: React.FC<{ seed: number; color: string }> = ({ seed, color }) => {
  const frame = useCurrentFrame();
  return (
    <svg width={1920} height={1080} viewBox="-960 -540 1920 1080" style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}>
      <g transform={`rotate(${frame * 0.35 + seed * 40})`}>
        {Array.from({ length: 18 }).map((_, i) => (
          <polygon key={i} points="0,0 -60,-1400 60,-1400" fill={color} opacity={0.035 + 0.03 * rand(i + seed)} transform={`rotate(${i * 20})`} />
        ))}
      </g>
    </svg>
  );
};

const Vignette: React.FC<{ icon: IconName; label: string; amount: string; start: number; end: number; dir: number; last: boolean; k: number }> = ({
  icon,
  label,
  amount,
  start,
  end,
  dir,
  last,
  k,
}) => {
  const frame = useCurrentFrame();
  const t = useT();
  if (frame < start - 1 || frame > end + 7) return null;
  const pin = prog(frame, start, 8, ease.out);
  const pout = last ? 0 : prog(frame, end, 7, ease.in);
  const x = dir * ((1 - pin) * 820 - pout * 820);
  const blur = (1 - pin) * 70 + pout * 70;
  const local = frame - start;
  const len = end - start;
  const push = interpolate(local, [0, len], [1.06, 1], clamp);
  const chip = prog(frame, start + 15, 8, ease.out);
  const ring = frame - (start + 15);
  const fid = `vb-${k}`;
  const left = k % 2 === 0;
  return (
    <AbsoluteFill style={{ transform: `translateX(${x}px)`, filter: blur > 0.5 ? `url(#${fid})` : undefined }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={fid} x="-10%" y="0%" width="120%" height="100%">
          <feGaussianBlur stdDeviation={`${blur.toFixed(1)} 0`} edgeMode="duplicate" />
        </filter>
      </svg>
      <Backdrop hue="amber" light={0.95} />
      <Rays seed={k} color={C.amber} />
      {/* giant outline amount drifting behind (parallax) */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: F.hiDisplay,
            fontSize: 560,
            color: "transparent",
            WebkitTextStroke: "2px rgba(255,165,58,0.1)",
            transform: `translateX(${(left ? -1 : 1) * (120 - local * 2.2)}px)`,
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          {amount}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ flexDirection: left ? "row" : "row-reverse", alignItems: "center", justifyContent: "center", gap: 90, transform: `scale(${push})` }}>
        <div style={{ position: "relative", width: 340, height: 340, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `2px solid ${C.amber}`,
              opacity: 0.5 * (1 - prog(local, 0, 30)),
              transform: `scale(${0.6 + prog(local, 0, 30) * 0.7})`,
            }}
          />
          <div style={{ transform: `scale(${interpolate(prog(local, 0, 10, ease.out), [0, 1], [1.3, 1])}) rotate(${(1 - prog(local, 0, 12)) * -10}deg)` }}>
            <Icon name={icon} start={start} size={300} dur={14} stagger={3} />
          </div>
        </div>
        <div style={{ textAlign: left ? "left" : "right", minWidth: 560 }}>
          <div style={{ overflow: "hidden", padding: "0.1em 0", margin: "-0.1em 0" }}>
            <div
              style={{
                fontFamily: F.hiDisplay,
                fontSize: 160,
                color: C.ink,
                lineHeight: 1,
                letterSpacing: "0.04em",
                transform: `translateY(${(1 - prog(local, 2, 12, ease.out)) * 105}%)`,
              }}
            >
              {label}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: left ? "flex-start" : "flex-end", marginTop: 4 }}>
            <SlotText text={amount} start={start + 4} size={110} color={C.amber} />
          </div>
          <div style={{ display: "flex", justifyContent: left ? "flex-start" : "flex-end", marginTop: 18 }}>
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 24px",
                borderRadius: 40,
                background: "rgba(61,220,132,0.14)",
                border: `2px solid ${C.green}`,
                color: C.green,
                fontFamily: F.mono,
                fontSize: 26,
                letterSpacing: "0.18em",
                opacity: chip,
                transform: `scale(${interpolate(chip, [0, 1], [0.6, 1])})`,
                boxShadow: `0 0 30px rgba(61,220,132,${0.35 * chip})`,
              }}
            >
              {ring >= 0 && ring < 18 && (
                <div style={{ position: "absolute", inset: -4, borderRadius: 44, border: `2px solid ${C.green}`, opacity: 1 - ring / 18, transform: `scale(${1 + ring * 0.04})` }} />
              )}
              <span style={{ fontSize: 30 }}>✓</span>
              {t("PAID · भुगतान", "PAID")}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------ C: one scan, two seconds */

const N_BURST = 110;
const BurstScene: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const n = N_BURST * 3;
  const buf = useMemo(() => ({ pos: new Float32Array(n * 3), size: new Float32Array(n), alpha: new Float32Array(n), col: new Float32Array(n * 3) }), [n]);
  const age = frame - at;
  for (let i = 0; i < N_BURST; i++) {
    const th = rand(i * 1.3) * Math.PI * 2;
    const ph = Math.acos(1 - rand(i * 2.7) * 1.2);
    const dir = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th) * 0.8, Math.cos(ph) * 0.9 + 0.2];
    const sp = 0.22 + rand(i * 4.1) * 0.5;
    for (let j = 0; j < 3; j++) {
      const k = i * 3 + j;
      const a = age - j * 0.8;
      if (age < 0 || a < 0 || age > 40) {
        buf.alpha[k] = 0;
        continue;
      }
      const d = sp * 9 * (1 - Math.exp(-a / 9));
      buf.pos[k * 3] = dir[0] * d;
      buf.pos[k * 3 + 1] = 0.2 + dir[1] * d;
      buf.pos[k * 3 + 2] = 0.3 + dir[2] * d;
      buf.size[k] = (0.2 - j * 0.05) * (1 + rand(i) * 0.6);
      buf.alpha[k] = Math.pow(c01(1 - age / 40), 1.4) * (1 - j * 0.3);
      const amber = rand(i * 9.9) > 0.75;
      buf.col.set(amber ? [1, 0.7, 0.3] : [0.35, 1, 0.9], k * 3);
    }
  }
  const ringP = c01(age / 20);
  return (
    <>
      <GlowPoints positions={buf.pos} sizes={buf.size} alphas={buf.alpha} colors={buf.col} />
      {age >= 0 && age < 20 && (
        <mesh position={[0, 0.2, 0.2]} scale={[0.5 + ringP * 7, 0.5 + ringP * 7, 1]}>
          <ringGeometry args={[0.92, 1, 96]} />
          <meshBasicMaterial color={C.teal} transparent opacity={Math.pow(1 - ringP, 2) * 0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </>
  );
};

const ScanShot: React.FC<{ len: number; paidAt: number }> = ({ len, paidAt }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const scan = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "scan"), []);
  const done = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "done"), []);
  // camera orbits round the phone from low left, then punches in after the payment lands
  const th = keys(frame, [[0, -0.75], [paidAt, 0.06], [len, 0.16]]);
  const R = keys(frame, [[0, 10.5], [paidAt, 8.8], [len, 7.4]]);
  const camY = keys(frame, [[0, -1.6], [paidAt, 0.3], [len, 0.5]]);
  const ry = keys(frame, [[0, -0.5], [paidAt, -0.12], [len, 0.08]]);
  const timeP = c01(frame / Math.max(1, paidAt));
  const paid = frame >= paidAt;
  return (
    <AbsoluteFill>
      <Backdrop hue="teal" />
      <Stage>
        <CamRig pos={[Math.sin(th) * R + drift(frame, 4, 0.12), camY, Math.cos(th) * R]} target={[0, 0.1, 0]} />
        <ambientLight intensity={0.2} />
        <spotLight position={[4, 6, 6]} angle={0.5} penumbra={0.8} intensity={120} color="#ffd2a0" />
        <pointLight position={[-4, -2, 3]} intensity={40} color={C.teal} />
        <Phone screen={paid ? done : scan} rotation={[0.08, ry, 0.04]} glow={1.15} scan={!paid ? (frame % 24) / 24 : undefined} />
        <BurstScene at={paidAt} />
      </Stage>
      <div style={{ position: "absolute", right: 150, top: 330, width: 330, height: 330, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={330} height={330} viewBox="-165 -165 330 330" style={{ position: "absolute", inset: 0 }}>
          <circle r={150} fill="none" stroke="rgba(242,239,232,0.12)" strokeWidth={6} />
          <circle
            r={150}
            fill="none"
            stroke={paid ? C.green : C.teal}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 150}
            strokeDashoffset={2 * Math.PI * 150 * (1 - timeP)}
            transform="rotate(-90)"
            style={{ filter: `drop-shadow(0 0 10px ${paid ? C.green : C.teal})` }}
          />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: F.mono, fontSize: 24, color: C.inkDim, letterSpacing: "0.3em" }}>{t("समय", "TIME")}</div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 150, color: paid ? C.green : C.ink, lineHeight: 1, transform: `scale(${paid ? interpolate(frame - paidAt, [0, 6], [1.25, 1], clamp) : 1})` }}>
            {(timeP * 2).toFixed(1)}s
          </div>
        </div>
      </div>
      <Flash at={paidAt} color="61,220,132" peak={0.4} len={10} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------- D/E: FREE, in 3D — then it shatters */

const SHARDS = (() => {
  const cols = 5;
  const rows = 3;
  const P = (i: number, j: number): [number, number] => [
    (i / cols) * 100 + (i > 0 && i < cols ? (rand(i * 7 + j * 13) - 0.5) * 12 : 0),
    (j / rows) * 100 + (j > 0 && j < rows ? (rand(i * 3 + j * 17) - 0.5) * 22 : 0),
  ];
  const tris: [number, number][][] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (rand(i + j * 5) > 0.5) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
    }
  return tris.map((tri, k) => ({
    poly: tri.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(", "),
    cx: (tri[0][0] + tri[1][0] + tri[2][0]) / 3,
    cy: (tri[0][1] + tri[1][1] + tri[2][1]) / 3,
    r: rand(k * 4.4 + 1),
  }));
})();

const LAYERS = 16;
const WORD: React.CSSProperties = { fontFamily: F.wide, fontWeight: 800, fontSize: 290, letterSpacing: "0.1em", lineHeight: 1, whiteSpace: "nowrap", padding: "0 0.06em 0 0.16em" };

const FreeWord3D: React.FC<{ crackAt: number }> = ({ crackAt }) => {
  const frame = useCurrentFrame();
  const inP = prog(frame, 0, 12, ease.out);
  const cracked = frame >= crackAt;
  const age = frame - crackAt;
  const ry = interpolate(frame, [0, crackAt], [-24, 12], clamp) + drift(frame, 2, 2);
  const rx = 10 + drift(frame, 5, 2);
  const jit = cracked && age < 8 ? (rand(frame * 1.7) - 0.5) * 36 : 0;
  const sheen = interpolate(frame, [6, crackAt], [120, -40], clamp);
  const front: React.CSSProperties = {
    ...WORD,
    backgroundImage: `linear-gradient(100deg, ${C.teal} 0%, ${C.teal} ${sheen - 12}%, #eafffb ${sheen}%, ${C.teal} ${sheen + 12}%, #19b3a8 100%)`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
  const crackDraw = prog(frame, crackAt - 5, 6, ease.out);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1300, opacity: inP }}>
      <div
        style={{
          position: "relative",
          transformStyle: "preserve-3d",
          transform: `translateX(${jit}px) translateY(-40px) scale(${interpolate(inP, [0, 1], [1.5, 1])}) rotateX(${rx}deg) rotateY(${ry}deg)`,
        }}
      >
        {/* extrusion: stacked layers fading into the dark */}
        {!cracked &&
          Array.from({ length: LAYERS }).map((_, i) => {
            const k = LAYERS - i;
            const shade = 1 - k / LAYERS;
            return (
              <div key={i} style={{ ...WORD, position: "absolute", left: 0, top: 0, color: `rgb(${8 + 20 * shade}, ${50 + 110 * shade}, ${52 + 100 * shade})`, transform: `translateZ(${-k * 3}px)` }}>
                FREE
              </div>
            );
          })}
        {!cracked ? (
          <div style={{ ...front, position: "relative", textShadow: undefined, filter: `drop-shadow(0 0 40px rgba(46,230,214,0.35))` }}>FREE</div>
        ) : (
          <div style={{ ...WORD, position: "relative", color: "transparent" }}>FREE</div>
        )}
        {/* the crack */}
        {crackDraw > 0 && age < 3 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <polyline
              points="0,52 14,47 22,58 37,44 49,55 61,41 72,57 84,46 100,53"
              fill="none"
              stroke="#fff"
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - crackDraw}
              style={{ filter: "drop-shadow(0 0 6px #fff)" }}
            />
          </svg>
        )}
        {cracked &&
          SHARDS.map((s, i) => {
            const tt = age;
            const dx = (s.cx - 50) * 0.5 * tt * (0.7 + s.r);
            const dy = (s.cy - 50) * 0.4 * tt * (0.7 + s.r) + 1.1 * tt * tt;
            const op = 1 - prog(tt, 8, 22);
            if (op <= 0) return null;
            return (
              <div
                key={i}
                style={{
                  ...WORD,
                  position: "absolute",
                  left: 0,
                  top: 0,
                  color: tt < 4 ? "#ffd6d6" : C.red,
                  clipPath: `polygon(${s.poly})`,
                  opacity: op,
                  transform: `translate3d(${dx}px, ${dy}px, ${tt * 26 * (0.5 + s.r)}px) rotateZ(${(s.r - 0.5) * tt * 16}deg) rotateX(${(rand(i * 3) - 0.5) * tt * 12}deg) rotateY(${(rand(i * 5) - 0.5) * tt * 12}deg)`,
                  textShadow: `0 0 30px ${C.red}88`,
                }}
              >
                FREE
              </div>
            );
          })}
      </div>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------- F: the endless bill */

const BillStrip: React.FC<{ start: number; len: number; x: number; width: number; speed: number; blur: number; rot: number; seed: number; opacity: number }> = ({
  start,
  len,
  x,
  width,
  speed,
  blur,
  rot,
  seed,
  opacity,
}) => {
  const frame = useCurrentFrame() - start;
  const t = useT();
  const y = interpolate(frame, [0, len], [760, 760 - 1800 * speed], { ...clamp, easing: ease.soft });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        transform: `rotateX(34deg) rotateZ(${rot}deg)`,
        transformOrigin: "50% 0%",
        background: "linear-gradient(#efe7d6, #e2d8c3)",
        boxShadow: "0 40px 120px rgba(0,0,0,0.8), 0 0 80px rgba(255,165,58,0.15)",
        padding: "40px 46px",
        fontFamily: F.mono,
        color: C.paperInk,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
        opacity,
      }}
    >
      <div style={{ fontFamily: F.hiDisplay, fontSize: 74, textAlign: "center", letterSpacing: "0.1em" }}>{t("BILL · बिल", "THE BILL")}</div>
      <div style={{ fontSize: 20, textAlign: "center", letterSpacing: "0.3em", opacity: 0.6, marginBottom: 18 }}>PAYABLE BY: ?</div>
      {Array.from({ length: 46 }).map((_, i) => {
        const rowY = y + 160 + i * 41; // rows light up as they pass the scan line
        const hot = Math.max(0, 1 - Math.abs(rowY - 520) / 120);
        return (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 24, padding: "7px 0", borderBottom: "1px dashed rgba(0,0,0,0.2)", background: `rgba(255,165,58,${hot * 0.25})` }}>
            <span style={{ width: 200 + rand(i + seed) * 120, height: 14, marginTop: 6, background: "rgba(29,26,22,0.22)", borderRadius: 3 }} />
            <span>₹ {(Math.floor(rand(i * 3 + seed) * 9000) + 100).toLocaleString("en-IN")}</span>
          </div>
        );
      })}
    </div>
  );
};

const Scramble: React.FC<{ n: number }> = ({ n }) => {
  const frame = useCurrentFrame();
  const s = Array.from({ length: n }, (_, i) => Math.floor(rand(Math.floor(frame / 2) * 13 + i * 7) * 10)).join("");
  return <>{s}</>;
};

const EndlessBill: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const totalP = prog(frame, 18, 16, ease.out);
  return (
    <AbsoluteFill style={{ perspective: 1200, transform: `rotate(${interpolate(frame, [0, len], [-1.5, 1.5])}deg)` }}>
      <BillStrip start={0} len={len} x={1380} width={420} speed={0.75} blur={5} rot={6} seed={50} opacity={0.55} />
      <BillStrip start={0} len={len} x={980} width={380} speed={0.55} blur={8} rot={-9} seed={90} opacity={0.35} />
      <BillStrip start={0} len={len} x={1160} width={560} speed={1.0} blur={0} rot={-3} seed={0} opacity={1} />
      <AbsoluteFill style={{ background: "linear-gradient(#04060b 0%, rgba(4,6,11,0) 25%, rgba(4,6,11,0) 70%, #04060b 100%)" }} />
      <div style={{ position: "absolute", left: 1120, right: 120, top: 519, height: 2, background: `linear-gradient(90deg, rgba(255,165,58,0), ${C.amber}, rgba(255,165,58,0))`, boxShadow: `0 0 20px ${C.amber}` }} />
      <div style={{ position: "absolute", right: 150, bottom: 170, textAlign: "right", opacity: totalP, transform: `translateY(${(1 - totalP) * 20}px)` }}>
        <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.3em", color: C.inkDim }}>TOTAL · PAYABLE BY ?</div>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 86, color: C.amber, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
          ₹ <Scramble n={10} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------ G: WHO? */

const WhoSlam: React.FC<{ at: number; word: string }> = ({ at, word }) => {
  const frame = useCurrentFrame();
  const age = frame - at;
  if (age < 0) return null;
  const p = prog(frame, at, 6, ease.out);
  const split = Math.max(0, 1 - age / 12) * 22;
  const push = interpolate(age, [6, 120], [1, 1.07], clamp);
  const ring = c01(age / 22);
  const base: React.CSSProperties = { fontFamily: F.hiDisplay, fontSize: 380, lineHeight: 0.9, whiteSpace: "nowrap" };
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(60px) scale(${push})` }}>
      <svg width={1920} height={1080} viewBox="-960 -540 1920 1080" style={{ position: "absolute", inset: 0 }}>
        <circle r={60 + ring * 1100} fill="none" stroke={C.amber} strokeWidth={30 * (1 - ring) + 1} opacity={0.6 * Math.pow(1 - ring, 1.5)} />
        <circle r={40 + c01(age / 30) * 800} fill="none" stroke="#fff" strokeWidth={2} opacity={0.35 * (1 - c01(age / 30))} />
      </svg>
      <div style={{ position: "relative", opacity: p, transform: `scale(${interpolate(p, [0, 1], [2.1, 1])})`, filter: p < 1 ? `blur(${(1 - p) * 16}px)` : undefined }}>
        {split > 0.3 && (
          <>
            <div style={{ ...base, position: "absolute", inset: 0, color: C.red, opacity: 0.7, transform: `translateX(${-split}px)`, mixBlendMode: "screen" }}>{word}</div>
            <div style={{ ...base, position: "absolute", inset: 0, color: C.teal, opacity: 0.7, transform: `translateX(${split}px)`, mixBlendMode: "screen" }}>{word}</div>
          </>
        )}
        <div style={{ ...base, position: "relative", color: C.ink, textShadow: `0 0 ${90 + 30 * Math.sin(age * 0.15)}px rgba(255,165,58,0.4)` }}>{word}</div>
      </div>
    </AbsoluteFill>
  );
};

/* =============================================================================== S00 */

export const S00_ColdOpen: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const L = relLines(seg);
  const a = L.c0_01, b = L.c0_02, c = L.c0_03, d = L.c0_04, e = L.c0_05, f = L.c0_06, g = L.c0_07;
  const mapIn = a.at - 8;
  const countAt = a.at + Math.round(a.len * a.fr(0.45));
  const third = (b.end - b.at) / 3;
  const vig = [0, 1, 2].map((k) => Math.round(k * third));
  const paidAt = Math.round(c.len * c.fr(0.72));
  const crackAt = e.at - d.at;
  const whoAt = g.at + Math.round(g.len * g.fr(0.45));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* pre-roll: a single ticking hand, then we dive through it */}
      <Sequence durationInFrames={mapIn + 6} layout="none">
        <PreRoll end={mapIn + 6} />
      </Sequence>

      {/* A — the night map of India, payments streaking between cities */}
      <Sequence from={mapIn} durationInFrames={b.at - mapIn + 2} layout="none">
        <NightMap len={b.at - mapIn + 2} countAt={countAt - mapIn} text={t("हर दिन... *80 करोड़* बार।", "Every day... *800 million* times.")} />
      </Sequence>

      {/* B — chai, petrol, rent: whip, whip, whip */}
      <Sequence from={b.at} durationInFrames={c.at - b.at} layout="none">
        <Vignette k={0} dir={1} icon="chai" label={t("चाय", "TEA")} amount="₹20" start={vig[0]} end={vig[1]} last={false} />
        <Vignette k={1} dir={-1} icon="fuel" label={t("पेट्रोल", "PETROL")} amount="₹2,500" start={vig[1]} end={vig[2]} last={false} />
        <Vignette k={2} dir={1} icon="rent" label={t("किराया", "RENT")} amount="₹15,000" start={vig[2]} end={c.at - b.at} last />
      </Sequence>

      {/* C — one scan, two seconds, and the money flies */}
      <Sequence from={c.at} durationInFrames={d.at - c.at} layout="none">
        <ScanShot len={d.at - c.at} paidAt={paidAt} />
      </Sequence>

      {/* D/E — FREE ... cracks */}
      <Sequence from={d.at} durationInFrames={f.at - d.at} layout="none">
        <Backdrop hue={frame >= e.at ? "red" : "teal"} light={0.85} />
        <FreeWord3D crackAt={crackAt} />
        <Flash at={crackAt} color="255,59,59" peak={0.45} len={12} />
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 170 }}>
          {frame < e.at ? (
            <div style={{ display: "flex", gap: 60 }}>
              <Stamp text="FEE ₹0" at={8} color={C.teal} rotate={-6} size={90} />
              <Stamp text="CHARGE ₹0" at={Math.round(d.len * d.fr(0.45))} color={C.teal} rotate={5} size={90} />
            </div>
          ) : (
            <Words text={t("दुनिया का सबसे बड़ा real-time payment system...|*फ़्री में नहीं चलता।*", "The world's largest real-time payment system...|*does not run for free.*")} start={crackAt + 6} size={64} accent={C.red} stagger={3} />
          )}
        </AbsoluteFill>
      </Sequence>

      {/* F — the endless bill */}
      <Sequence from={f.at} durationInFrames={g.at - f.at} layout="none">
        <Backdrop hue="amber" light={0.7} />
        <EndlessBill len={g.at - f.at} />
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 160 }}>
          <Words text={t("कोई तो है...|जो *हर दिन*|इसका बिल|भर रहा है।", "Someone...|is paying|its bill|*every day.*")} start={4} size={96} font={F.hiDisplay} weight={500} align="left" lineHeight={1.0} stagger={4} />
        </AbsoluteFill>
      </Sequence>

      {/* G — the question */}
      <Sequence from={g.at} layout="none">
        <AbsoluteFill style={{ background: "#020305" }}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 250 }}>
            <Words text={t("सवाल ये है —", "The question is —")} start={0} size={56} color={C.inkDim} weight={500} />
          </AbsoluteFill>
          <WhoSlam at={whoAt - g.at} word={t("कौन?", "WHO?")} />
        </AbsoluteFill>
      </Sequence>
      <Dust count={40} />
    </AbsoluteFill>
  );
};

/* ============================================================== S01 TITLE: the slam */

const Tunnel: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const a = 1 - prog(frame, 0, len, ease.out);
  if (a <= 0.01) return null;
  return (
    <svg width={1920} height={1080} viewBox="-960 -540 1920 1080" style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}>
      {Array.from({ length: 70 }).map((_, i) => {
        const ang = rand(i * 2.1) * Math.PI * 2;
        const r0 = 120 + ((rand(i * 3.3) * 900 + frame * 70) % 1100);
        const r1 = r0 + 80 + frame * 14;
        return (
          <line
            key={i}
            x1={Math.cos(ang) * r0}
            y1={Math.sin(ang) * r0}
            x2={Math.cos(ang) * r1}
            y2={Math.sin(ang) * r1}
            stroke={i % 3 ? "#ffd9a8" : "#ffffff"}
            strokeWidth={1.5 + rand(i) * 2}
            opacity={a * (0.25 + rand(i * 5) * 0.5)}
          />
        );
      })}
    </svg>
  );
};

export const S01_Title: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const TL = useTL();
  const t = useT();
  const lang = useLang();
  const p1 = prog(frame, 0, 7, ease.out);
  const p2 = prog(frame, 4, 7, ease.out);
  const sub = prog(frame, 16, 16, ease.out);
  const outP = prog(frame, seg.frames - 10, 10, ease.in);
  const push = interpolate(frame, [0, seg.frames], [1.0, 1.07], clamp) * (1 + outP * 0.18);
  const track = interpolate(frame, [0, seg.frames], [0.6, 0.34], { ...clamp, easing: ease.soft });
  const sweep = interpolate(frame, [22, 56], [-30, 130], clamp);
  const glitchOn = frame >= 6 && frame < 14 && Math.floor(frame / 2) % 2 === 0;
  const ring = c01(frame / 24);
  const line: React.CSSProperties = {
    fontFamily: F.hiDisplay,
    fontSize: 196,
    lineHeight: 0.95,
    color: C.ink,
    textAlign: "center",
    textShadow: "0 0 70px rgba(255,165,58,0.35), 0 10px 40px rgba(0,0,0,0.8)",
    whiteSpace: "nowrap",
  };
  const free = (
    <span style={{ color: C.amber, display: "inline-block", transform: glitchOn ? `translateX(${(rand(frame) - 0.5) * 30}px) skewX(-8deg)` : undefined, textShadow: glitchOn ? `-6px 0 ${C.red}, 6px 0 ${C.teal}` : undefined }}>
      FREE
    </span>
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop hue="amber" light={1.2} />
      <Stage bloom={1.2} env={false}>
        <CamRig pos={[0, 0, keys(frame, [[0, 16], [12, 11], [seg.frames, 8.5]])]} />
        <RupeeField count={300} opacity={0.6} speed={2.6} />
      </Stage>
      <Tunnel len={16} />
      <svg width={1920} height={1080} viewBox="-960 -540 1920 1080" style={{ position: "absolute", inset: 0 }}>
        <circle r={100 + ring * 1200} fill="none" stroke={C.amber} strokeWidth={26 * (1 - ring) + 1} opacity={0.55 * Math.pow(1 - ring, 1.5)} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 538, height: 4, background: `linear-gradient(90deg, rgba(0,0,0,0), rgba(255,200,140,${0.9 * (1 - prog(frame, 0, 18))}) 50%, rgba(0,0,0,0))`, mixBlendMode: "screen" }} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${push})`,
          opacity: 1 - outP,
          filter: outP > 0.02 ? `blur(${outP * 14}px)` : undefined,
          WebkitMaskImage: frame > 20 ? `linear-gradient(100deg, rgba(0,0,0,0.78) ${sweep - 22}%, #000 ${sweep}%, rgba(0,0,0,0.78) ${sweep + 22}%)` : undefined,
        }}
      >
        <div style={{ ...line, opacity: p1, transform: `translateY(${(1 - p1) * -140}px) scale(${interpolate(p1, [0, 1], [1.3, 1])})`, filter: p1 < 1 ? `blur(${(1 - p1) * 18}px)` : undefined }}>
          {lang === "en" ? (
            <>WHO REALLY PAYS</>
          ) : (
            <>
              {free} UPI का बिल
            </>
          )}
        </div>
        <div style={{ ...line, opacity: p2, transform: `translateY(${(1 - p2) * 140}px) scale(${interpolate(p2, [0, 1], [1.3, 1])})`, filter: p2 < 1 ? `blur(${(1 - p2) * 18}px)` : undefined }}>
          {lang === "en" ? <>FOR {free} UPI?</> : <>कौन भरता है?</>}
        </div>
        <div style={{ overflow: "hidden", marginTop: 34 }}>
          <div
            style={{
              fontFamily: F.wide,
              fontWeight: 300,
              fontSize: 30,
              letterSpacing: `${track}em`,
              paddingLeft: `${track}em`,
              color: C.inkDim,
              transform: `translateY(${(1 - sub) * 110}%)`,
              whiteSpace: "nowrap",
            }}
          >
            {t(TL.title_en, "THE HIDDEN COST OF INDIA'S DIGITAL PAYMENTS")}
          </div>
        </div>
        <div style={{ width: 640 * prog(frame, 18, 22), height: 1, marginTop: 26, background: `linear-gradient(90deg, transparent, ${C.amber}, transparent)` }} />
      </AbsoluteFill>
      <LightLeak start={0} dur={seg.frames} strength={0.5} />
      <Letterbox amount={1} />
    </AbsoluteFill>
  );
};
