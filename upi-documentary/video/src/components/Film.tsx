import { AbsoluteFill, staticFile, useCurrentFrame } from "remotion";
import { clamp, drift } from "../lib/anim";
import { interpolate } from "remotion";

/**
 * Film grain + vignette. For final renders these are applied by ffmpeg in tools/finish.sh
 * (much faster than compositing them per frame on the CPU), so this only draws when `on`.
 */
export const Film: React.FC<{ grain?: number; vignette?: number; on?: boolean }> = ({ grain = 0.16, vignette = 0.75, on = false }) => {
  const frame = useCurrentFrame();
  if (!on) return null;
  const g = Math.floor(frame / 2) % 8; // grain changes every 2 frames (12 fps grain = film-like)
  const ox = (frame * 137) % 512;
  const oy = (frame * 251) % 512;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile(`tex/grainA${g}.png`)})`,
          backgroundSize: "512px 512px",
          backgroundPosition: `${ox}px ${oy}px`,
          opacity: grain,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${vignette}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Cinema letterbox bars (2.39:1 inside the 16:9 frame). amount 0..1 */
export const Letterbox: React.FC<{ amount: number }> = ({ amount }) => {
  const bar = 136 * amount; // 1080 - 1920/2.39 = ~277 → 138 per side
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bar, background: "#000" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bar, background: "#000" }} />
    </AbsoluteFill>
  );
};

/** Warm anamorphic light leak that drifts across the frame. */
export const LightLeak: React.FC<{ start: number; dur: number; color?: string; strength?: number; seed?: number }> = ({
  start,
  dur,
  color = "255,150,60",
  strength = 0.55,
  seed = 1,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + dur], [0, 1], clamp);
  const a = Math.sin(Math.PI * t) * strength;
  if (a <= 0.001) return null;
  const x = interpolate(t, [0, 1], [-20, 120]) + drift(frame, seed, 4);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 42% 95% at ${x}% 50%, rgba(${color},${a}) 0%, rgba(${color},${a * 0.45}) 30%, rgba(${color},${a * 0.12}) 55%, rgba(0,0,0,0) 75%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "49.4%",
          left: 0,
          right: 0,
          height: 12,
          background: `linear-gradient(90deg, rgba(0,0,0,0), rgba(${color},${a * 0.35}) ${x - 20}%, rgba(${color},${a * 0.9}) ${x}%, rgba(${color},${a * 0.35}) ${x + 20}%, rgba(0,0,0,0))`,
        }}
      />
    </AbsoluteFill>
  );
};

/** A full-frame flash used on hard cuts (synced with an impact in the score). */
export const Flash: React.FC<{ at: number; color?: string; len?: number; peak?: number }> = ({
  at,
  color = "255,244,230",
  len = 10,
  peak = 0.85,
}) => {
  const frame = useCurrentFrame();
  const d = frame - at;
  if (d < -2 || d > len) return null;
  const a = d < 0 ? ((d + 2) / 2) * peak : peak * Math.pow(1 - d / len, 2.2);
  return <AbsoluteFill style={{ background: `rgba(${color},${a})`, pointerEvents: "none", mixBlendMode: "screen" }} />;
};
