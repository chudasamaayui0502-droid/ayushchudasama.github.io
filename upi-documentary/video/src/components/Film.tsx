import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { clamp, drift } from "../lib/anim";
import { interpolate } from "remotion";

/** Film grain + vignette + gentle gate weave. Sits on top of everything. */
export const Film: React.FC<{ grain?: number; vignette?: number }> = ({ grain = 0.09, vignette = 0.75 }) => {
  const frame = useCurrentFrame();
  const g = Math.floor(frame / 2) % 8; // grain changes every 2 frames (12 fps grain = film-like)
  const ox = (frame * 37) % 64;
  const oy = (frame * 53) % 64;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Img
        src={staticFile(`tex/grain${g}.png`)}
        style={{
          position: "absolute",
          left: -64 + ox,
          top: -64 + oy,
          width: 1920 + 128,
          height: 1080 + 128,
          opacity: grain,
          mixBlendMode: "overlay",
          imageRendering: "auto",
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
          background: `radial-gradient(ellipse 38% 90% at ${x}% 50%, rgba(${color},${a}) 0%, rgba(${color},${a * 0.35}) 35%, rgba(0,0,0,0) 70%)`,
          filter: "blur(30px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "49.6%",
          left: 0,
          right: 0,
          height: 6,
          background: `linear-gradient(90deg, rgba(0,0,0,0), rgba(${color},${a * 0.9}) ${x}%, rgba(0,0,0,0))`,
          filter: "blur(3px)",
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
