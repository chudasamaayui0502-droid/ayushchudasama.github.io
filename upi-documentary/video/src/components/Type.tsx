import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { clamp, ease, prog } from "../lib/anim";
import { useLang } from "../lang";

/**
 * Kinetic words. Splits on spaces only (safe for Devanagari conjuncts).
 * Wrap a word in *stars* to colour it with `accent`; use "|" for a forced line break.
 */
export const Words: React.FC<{
  text: string;
  start: number;
  stagger?: number;
  size?: number;
  font?: string;
  weight?: number;
  color?: string;
  accent?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  tracking?: number;
  out?: number; // frame at which to fade the whole block out
  style?: React.CSSProperties;
  mode?: "rise" | "blur" | "punch";
}> = ({
  text,
  start,
  stagger = 3,
  size = 64,
  font = F.hiBody,
  weight = 600,
  color = C.ink,
  accent = C.amber,
  align = "center",
  lineHeight = 1.25,
  tracking = 0,
  out,
  style,
  mode = "rise",
}) => {
  const frame = useCurrentFrame();
  const fadeOut = out !== undefined ? 1 - prog(frame, out, 10, ease.in) : 1;
  const lines = text.split("|");
  let idx = 0;
  let hotState = false;
  return (
    <div
      style={{
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        color,
        textAlign: align,
        lineHeight,
        letterSpacing: `${tracking}em`,
        opacity: fadeOut,
        ...style,
      }}
    >
      {lines.map((ln, li) => (
        <div key={li}>
          {ln
            .trim()
            .split(/\s+/)
            .map((w, wi) => {
              const i = idx++;
              const s = start + i * stagger;
              const p = prog(frame, s, mode === "punch" ? 7 : 14, ease.out);
              let word = w;
              if (word.startsWith("*")) {
                hotState = true;
                word = word.slice(1);
              }
              const hot = hotState;
              if (word.includes("*")) {
                hotState = false;
                word = word.replace(/\*/g, "");
              }
              const y = mode === "rise" ? (1 - p) * 0.55 : 0;
              const blur = mode === "punch" ? 0 : (1 - p) * 14;
              const sc = mode === "punch" ? interpolate(p, [0, 1], [1.6, 1]) : 1;
              return (
                <span
                  key={wi}
                  style={{
                    display: "inline-block",
                    marginRight: "0.26em",
                    opacity: p,
                    transform: `translateY(${y}em) scale(${sc})`,
                    filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
                    color: hot ? accent : undefined,
                    textShadow: hot ? `0 0 28px ${accent}66` : "0 2px 24px rgba(0,0,0,0.6)",
                  }}
                >
                  {word}
                </span>
              );
            })}
        </div>
      ))}
    </div>
  );
};

/** Nolan-style dateline: mono caps + Hindi, typed on, with a rule that draws out. */
export const Dateline: React.FC<{ en: string; hi?: string; start: number; x?: number; y?: number; out?: number; color?: string }> = ({
  en,
  hi,
  start,
  x = 120,
  y = 120,
  out,
  color = C.ink,
}) => {
  const frame = useCurrentFrame();
  const chars = Math.floor(interpolate(frame, [start, start + en.length * 1.6], [0, en.length], clamp));
  const rule = prog(frame, start + 4, 22, ease.out);
  const op = out !== undefined ? 1 - prog(frame, out, 10, ease.in) : 1;
  const hiP = prog(frame, start + 10, 16);
  const caret = frame - start < en.length * 1.6 + 8 && Math.floor(frame / 8) % 2 === 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: op }}>
      <div style={{ fontFamily: F.mono, fontSize: 30, letterSpacing: "0.32em", color, fontWeight: 500 }}>
        {en.slice(0, chars)}
        <span style={{ opacity: caret ? 1 : 0, color: C.amber }}>▌</span>
      </div>
      <div style={{ height: 2, width: 420 * rule, background: `linear-gradient(90deg, ${C.amber}, rgba(255,165,58,0))`, marginTop: 14 }} />
      {hi && (
        <div style={{ fontFamily: F.hiSerif, fontSize: 40, color: C.inkDim, marginTop: 12, opacity: hiP, transform: `translateY(${(1 - hiP) * 10}px)` }}>
          {hi}
        </div>
      )}
    </div>
  );
};

/** Lower-third source credit, documentary style. */
export const Source: React.FC<{ text: string; start: number; out?: number; y?: number }> = ({ text, start, out, y = 980 }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, start, 14);
  const op = out !== undefined ? 1 - prog(frame, out, 8, ease.in) : 1;
  return (
    <div style={{ position: "absolute", left: 120, top: y, display: "flex", alignItems: "center", gap: 16, opacity: p * op }}>
      <div style={{ width: 40 * p, height: 2, background: C.teal }} />
      <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.18em", color: C.inkDim, textTransform: "uppercase" }}>
        Source · {text}
      </div>
    </div>
  );
};

/** Slot-machine counter with Indian grouping. */
export const Counter: React.FC<{
  from?: number;
  to: number;
  start: number;
  dur: number;
  size?: number;
  color?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  indian?: boolean;
}> = ({ from = 0, to, start, dur, size = 140, color = C.ink, prefix = "", suffix = "", decimals = 0, indian }) => {
  const frame = useCurrentFrame();
  // Indian digit grouping (24,07,00,00,000) in the Hindi edition, international (24,070,000,000) in English
  const lang = useLang();
  const grouping = indian ?? lang !== "en";
  const t = prog(frame, start, dur, ease.soft);
  const v = from + (to - from) * t;
  const fixed = v.toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const grouped = grouping ? groupIndian(int) : int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const str = prefix + grouped + (dec ? "." + dec : "") + suffix;
  return (
    <div style={{ fontFamily: F.hiDisplay, fontSize: size, color, fontWeight: 500, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", textShadow: `0 0 40px ${color}55` }}>
      {str}
    </div>
  );
};

const groupIndian = (s: string) => {
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
};

/** Rubber stamp that slams in. */
export const Stamp: React.FC<{ text: string; at: number; color?: string; rotate?: number; size?: number; sub?: string; blend?: "screen" | "multiply" | "normal" }> = ({
  text,
  at,
  color = C.red,
  rotate = -8,
  size = 120,
  sub,
  blend = "screen",
}) => {
  const frame = useCurrentFrame();
  const d = frame - at;
  if (d < 0) return null;
  const p = prog(frame, at, 6, ease.in);
  const sc = interpolate(p, [0, 1], [2.4, 1]);
  const shake = d > 5 && d < 14 ? Math.sin(d * 3.1) * (14 - d) * 0.8 : 0;
  return (
    <div
      style={{
        display: "inline-block",
        transform: `translate(${shake}px, ${shake * 0.5}px) rotate(${rotate}deg) scale(${sc})`,
        opacity: Math.min(1, p * 1.4),
        border: `8px solid ${color}`,
        borderRadius: 14,
        padding: "8px 34px 2px",
        color,
        fontFamily: F.hiDisplay,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "0.06em",
        lineHeight: 1.05,
        textAlign: "center",
        boxShadow: `0 0 50px ${color}44, inset 0 0 30px ${color}33`,
        mixBlendMode: blend,
      }}
    >
      {text}
      {sub && <div style={{ fontFamily: F.mono, fontSize: size * 0.2, letterSpacing: "0.2em", paddingBottom: 10 }}>{sub}</div>}
    </div>
  );
};
