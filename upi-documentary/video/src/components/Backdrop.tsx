import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { drift, rand } from "../lib/anim";

/** Deep space-blue backdrop with a soft key light and drifting haze. */
export const Backdrop: React.FC<{ hue?: "teal" | "amber" | "red" | "neutral"; light?: number; grid?: boolean }> = ({
  hue = "teal",
  light = 1,
  grid = false,
}) => {
  const frame = useCurrentFrame();
  const tint =
    hue === "amber" ? "255,140,40" : hue === "red" ? "255,50,50" : hue === "neutral" ? "180,190,210" : "40,210,200";
  const lx = 50 + drift(frame, 3, 6);
  const ly = 38 + drift(frame, 7, 4);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${lx}% ${ly}%, rgba(${tint},${0.16 * light}) 0%, rgba(${tint},${0.05 * light}) 40%, rgba(0,0,0,0) 75%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 120% 60% at 50% 115%, rgba(10,16,30,1) 0%, rgba(4,6,11,0) 70%)`,
        }}
      />
      {grid && <PerspectiveGrid tint={tint} />}
      <Haze tint={tint} />
    </AbsoluteFill>
  );
};

const Haze: React.FC<{ tint: string }> = ({ tint }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: 0.5, filter: "blur(60px)" }}>
      {[0, 1, 2].map((i) => {
        const x = 20 + i * 30 + Math.sin(frame * 0.004 + i * 2) * 12;
        const y = 60 + Math.cos(frame * 0.003 + i) * 10;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: 700,
              height: 300,
              marginLeft: -350,
              marginTop: -150,
              borderRadius: "50%",
              background: `rgba(${tint},0.06)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Retro-future floor grid receding to a horizon (CSS 3D). */
const PerspectiveGrid: React.FC<{ tint: string }> = ({ tint }) => {
  const frame = useCurrentFrame();
  const off = (frame * 1.2) % 80;
  return (
    <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: "50% 40%" }}>
      <div
        style={{
          position: "absolute",
          left: "-50%",
          width: "200%",
          top: "55%",
          height: "120%",
          transform: "rotateX(74deg)",
          transformOrigin: "50% 0%",
          backgroundImage: `linear-gradient(rgba(${tint},0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(${tint},0.22) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          backgroundPosition: `0px ${off}px`,
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Floating dust motes caught in the key light. */
export const Dust: React.FC<{ count?: number; color?: string; speed?: number }> = ({
  count = 70,
  color = "255,240,220",
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const z = rand(i * 3.1);
        const size = 1.5 + z * 4.5;
        const x = (rand(i) * 1920 + frame * (0.15 + z * 0.6) * speed + drift(frame, i, 12)) % 1980;
        const y = (rand(i * 7.7) * 1080 - frame * (0.08 + z * 0.25) * speed + 1080 * 4) % 1100;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.03 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 30,
              top: y - 10,
              width: size,
              height: size,
              borderRadius: "50%",
              background: `rgba(${color},${(0.15 + z * 0.55) * tw})`,
              filter: z < 0.3 ? "blur(1.5px)" : undefined,
              boxShadow: z > 0.75 ? `0 0 ${size * 3}px rgba(${color},0.5)` : undefined,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
