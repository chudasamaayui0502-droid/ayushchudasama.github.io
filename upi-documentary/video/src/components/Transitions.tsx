import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { ease, rand } from "../lib/anim";

/**
 * Scene-to-scene transitions. Each cut is designed in tools/build_timeline.py (TRANSITIONS) and
 * scored with a matching sound in music/score.py, so picture and sound always agree.
 *
 * The outgoing scene plays its "out" half over the first `frames` of the incoming scene, which sits
 * on top and plays its "in" half. Overlays (light, slabs, glitch bars) are drawn by the incoming side.
 */
export type TransType = "whip" | "zoom" | "panel" | "glitch" | "light" | "push3d" | "dissolve";
export type Trans = { type: TransType; frames: number; dir: number; color: string };

const W = 1920;
const H = 1080;
const c01 = (x: number) => Math.max(0, Math.min(1, x));
const ACCENT: Record<string, string> = { amber: C.amber, teal: C.teal, red: C.red, "": C.amber };

type Look = { style: React.CSSProperties; blurX?: number };

/** Directional (horizontal) motion blur — an SVG filter, since CSS blur() is only isotropic. */
const MotionBlur: React.FC<{ id: string; x: number }> = ({ id, x }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id={id} x="-10%" y="0%" width="120%" height="100%" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={`${x.toFixed(1)} 0`} edgeMode="duplicate" />
    </filter>
  </svg>
);

const outLook = (tr: Trans, p: number, frame: number): Look => {
  const e = ease.in(p);
  switch (tr.type) {
    case "whip":
      return { style: { transform: `translateX(${-tr.dir * W * 0.42 * e}px)`, opacity: 1 - c01((p - 0.62) / 0.2) }, blurX: 90 * Math.sin(Math.PI * c01(p * 0.9)) };
    case "zoom":
      return { style: { transform: `scale(${1 + 0.85 * e})`, filter: `blur(${(22 * e).toFixed(1)}px) brightness(${1 + 0.6 * e})`, opacity: 1 - c01((p - 0.5) / 0.35) } };
    case "panel":
      return { style: { transform: `translateX(${-tr.dir * 170 * e}px) scale(${1 - 0.03 * e})`, filter: `brightness(${1 - 0.45 * e})` } };
    case "glitch": {
      const j = p > 0.1 && p < 0.7 ? (rand(frame * 3.7) - 0.5) * 70 : 0;
      return { style: { transform: `translateX(${j}px)`, filter: p > 0.25 && rand(frame) > 0.5 ? "contrast(1.5) saturate(1.8)" : undefined, opacity: p > 0.7 ? 0 : 1 } };
    }
    case "light":
      return { style: { transform: `scale(${1 + 0.06 * e})`, filter: `brightness(${1 + 1.6 * e})`, opacity: 1 - c01((p - 0.5) / 0.15) } };
    case "push3d":
      return {
        style: {
          transform: `perspective(2200px) translateX(${-tr.dir * W * 0.52 * e}px) translateZ(${-520 * e}px) rotateY(${-tr.dir * 40 * e}deg)`,
          filter: `brightness(${1 - 0.6 * e})`,
        },
      };
    default:
      return { style: { transform: `scale(${1 + 0.12 * e})`, filter: `blur(${(18 * e).toFixed(1)}px)`, opacity: 1 - e } };
  }
};

const inLook = (tr: Trans, p: number, frame: number): Look => {
  const e = ease.out(p);
  switch (tr.type) {
    case "whip":
      return { style: { transform: `translateX(${tr.dir * W * 0.42 * (1 - e)}px)`, opacity: c01((p - 0.22) / 0.3) }, blurX: 90 * Math.pow(1 - c01(p), 1.6) };
    case "zoom":
      return { style: { transform: `scale(${1.35 - 0.35 * e})`, filter: `blur(${(18 * (1 - e)).toFixed(1)}px)`, opacity: c01((p - 0.25) / 0.3) } };
    case "panel": {
      // revealed behind the second (dark) slab
      const edge = slabEdge(p, 0.14) - W * 0.2;
      return { style: { transform: `translateX(${tr.dir * 120 * (1 - e)}px)`, clipPath: panelClip(edge, tr.dir) } };
    }
    case "glitch":
      return { style: { clipPath: p < 1 ? glitchClip(p, frame) : undefined, transform: `translateX(${p < 0.85 ? (rand(frame * 1.3) - 0.5) * 50 * (1 - p) : 0}px)` } };
    case "light":
      return { style: { transform: `scale(${1.05 - 0.05 * e})`, filter: `brightness(${1 + 1.6 * (1 - e)})`, opacity: c01((p - 0.42) / 0.16) } };
    case "push3d":
      return {
        style: {
          transform: `perspective(2200px) translateX(${tr.dir * W * 0.52 * (1 - e)}px) translateZ(${-520 * (1 - e)}px) rotateY(${tr.dir * 40 * (1 - e)}deg)`,
          filter: `brightness(${0.4 + 0.6 * e})`,
        },
      };
    default:
      return { style: { transform: `scale(${1 + (1 - e) * 0.06})`, filter: `blur(${(12 * (1 - e)).toFixed(1)}px)`, opacity: e } };
  }
};

/** Leading edge of a panel slab sweeping across the frame (px), for slab k delayed by `delay`. */
const slabEdge = (p: number, delay: number) => -W * 0.35 + (W * 1.75) * ease.cam(c01((p - delay) / (1 - delay)));

const SLANT = 260;
/** Polygon for "everything left of the slanted edge" (dir 1) or right of it (dir -1). */
const panelClip = (edge: number, dir: number) => {
  if (dir > 0) return `polygon(0px 0px, ${edge + SLANT}px 0px, ${edge}px ${H}px, 0px ${H}px)`;
  const x = W - edge;
  return `polygon(${W}px 0px, ${x}px 0px, ${x - SLANT}px ${H}px, ${W}px ${H}px)`;
};

const slabPoly = (lead: number, width: number, dir: number) => {
  const a = lead - width;
  if (dir > 0) return `${a + SLANT},0 ${lead + SLANT},0 ${lead},${H} ${a},${H}`;
  const xl = W - lead;
  const xa = W - a;
  return `${xl},0 ${xa},0 ${xa - SLANT},${H} ${xl - SLANT},${H}`;
};

/** Horizontal bands of the incoming shot snapping in over the outgoing one. */
const glitchClip = (p: number, frame: number) => {
  const n = 18;
  const bh = H / n;
  let d = "";
  for (let i = 0; i < n; i++) {
    const th = rand(i * 7.1 + 3) * 0.75;
    const on = p > th || (p > th * 0.5 && rand(frame + i) > 0.6);
    if (on) d += `M0 ${(i * bh).toFixed(1)} H${W} V${((i + 1) * bh + 0.5).toFixed(1)} H0 Z `;
  }
  return d ? `path('${d}')` : "inset(50% 50% 50% 50%)";
};

/** What the incoming side draws on top of both shots. */
const Overlay: React.FC<{ tr: Trans; p: number; frame: number }> = ({ tr, p, frame }) => {
  if (p >= 1) return null;
  switch (tr.type) {
    case "zoom": {
      const a = Math.sin(Math.PI * c01(p * 1.15)) * 0.5;
      return <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, rgba(255,250,240,${a}) 0%, rgba(255,250,240,${a * 0.25}) 30%, rgba(0,0,0,0) 62%)`, mixBlendMode: "screen" }} />;
    }
    case "light": {
      const a = Math.exp(-((p - 0.5) ** 2) / (2 * 0.13 ** 2));
      const x = -20 + 140 * ease.cam(p);
      return (
        <AbsoluteFill style={{ mixBlendMode: "screen" }}>
          <AbsoluteFill style={{ background: `rgba(255,236,210,${0.82 * a})` }} />
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 30% 70% at ${x}% 50%, rgba(255,170,80,${0.7 * a}) 0%, rgba(255,140,60,${0.25 * a}) 45%, rgba(0,0,0,0) 70%)` }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: H / 2 - 3, height: 6, background: `linear-gradient(90deg, rgba(0,0,0,0), rgba(255,255,255,${a}) ${x}%, rgba(0,0,0,0))` }} />
        </AbsoluteFill>
      );
    }
    case "panel": {
      const col = ACCENT[tr.color] ?? C.amber;
      return (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          <polygon points={slabPoly(slabEdge(p, 0), W * 0.13, tr.dir)} fill={col} />
          <polygon points={slabPoly(slabEdge(p, 0.14), W * 0.2, tr.dir)} fill={C.bg2} />
          <polygon points={slabPoly(slabEdge(p, 0.14) - W * 0.2, 6, tr.dir)} fill={col} opacity={0.8} />
        </svg>
      );
    }
    case "glitch": {
      if (p > 0.8) return null;
      const bars = [0, 1, 2, 3, 4].map((i) => {
        const r = rand(frame * 13 + i * 5);
        return { y: r * H, h: 4 + rand(frame + i * 9) * 26, col: i % 2 ? C.teal : C.red, a: 0.35 + 0.4 * rand(i + frame) };
      });
      return (
        <AbsoluteFill style={{ mixBlendMode: "screen" }}>
          {bars.map((b, i) => (
            <div key={i} style={{ position: "absolute", left: 0, right: 0, top: b.y, height: b.h, background: b.col, opacity: b.a }} />
          ))}
          {Math.abs(p - 0.4) < 0.08 && <AbsoluteFill style={{ background: "rgba(255,255,255,0.22)" }} />}
        </AbsoluteFill>
      );
    }
    case "push3d":
      // soft depth shadow between the two panes
      return <AbsoluteFill style={{ background: `rgba(0,0,0,${0.25 * Math.sin(Math.PI * p)})` }} />;
    default:
      return null;
  }
};

/** Wraps one segment: plays its entrance (inTr) and its exit (outTr, starting at `span`). */
export const TransitionLayer: React.FC<{
  id: string;
  span: number;
  inTr?: Trans;
  outTr?: Trans;
  children: React.ReactNode;
}> = ({ id, span, inTr, outTr, children }) => {
  const frame = useCurrentFrame();
  const pin = inTr ? c01(frame / inTr.frames) : 1;
  const pout = outTr ? c01((frame - span) / outTr.frames) : 0;
  const looks: Look[] = [];
  if (inTr && pin < 1) looks.push(inLook(inTr, pin, frame));
  if (outTr && pout > 0) looks.push(outLook(outTr, pout, frame));
  const style: React.CSSProperties = {};
  let blurX = 0;
  const filters: string[] = [];
  const transforms: string[] = [];
  let opacity = 1;
  for (const l of looks) {
    if (l.style.transform) transforms.push(String(l.style.transform));
    if (l.style.filter) filters.push(String(l.style.filter));
    if (l.style.opacity !== undefined) opacity *= Number(l.style.opacity);
    if (l.style.clipPath) style.clipPath = l.style.clipPath;
    blurX = Math.max(blurX, l.blurX ?? 0);
  }
  const fid = `mb-${id}`;
  if (blurX > 0.5) filters.unshift(`url(#${fid})`);
  if (transforms.length) style.transform = transforms.join(" ");
  if (filters.length) style.filter = filters.join(" ");
  if (opacity < 1) style.opacity = opacity;
  return (
    <AbsoluteFill>
      {blurX > 0.5 && <MotionBlur id={fid} x={blurX} />}
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {inTr && <Overlay tr={inTr} p={pin} frame={frame} />}
    </AbsoluteFill>
  );
};
