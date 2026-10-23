import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { drift, rand } from "../lib/anim";

/** Deep space-blue backdrop with a soft key light and haze — pre-baked images (tools: tex/bg_*.png), drifting slowly. */
export const Backdrop: React.FC<{ hue?: "teal" | "amber" | "red" | "neutral"; light?: number; grid?: boolean }> = ({
  hue = "teal",
  light = 1,
  grid = false,
}) => {
  const frame = useCurrentFrame();
  const dx = drift(frame, 3, 22);
  const dy = drift(frame, 7, 12);
  const img: React.CSSProperties = { position: "absolute", left: -96 + dx, top: -54 + dy, width: 2112, height: 1188 };
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Img src={staticFile(`tex/bg_${hue}.png`)} style={{ ...img, opacity: Math.min(1, light) }} />
      {light > 1 && <Img src={staticFile(`tex/bg_${hue}.png`)} style={{ ...img, opacity: Math.min(1, light - 1), mixBlendMode: "screen" }} />}
      {grid && <Img src={staticFile(`tex/grid_${hue}.png`)} style={{ position: "absolute", inset: 0, width: 1920, height: 1080 }} />}
    </AbsoluteFill>
  );
};

const Haze: React.FC<{ tint: string }> = ({ tint }) => {
  const frame = useCurrentFrame();
  const blobs = [0, 1, 2].map((i) => {
    const x = 20 + i * 30 + Math.sin(frame * 0.004 + i * 2) * 12;
    const y = 60 + Math.cos(frame * 0.003 + i) * 10;
    return `radial-gradient(ellipse 22% 16% at ${x}% ${y}%, rgba(${tint},0.035) 0%, rgba(${tint},0.015) 50%, rgba(0,0,0,0) 100%)`;
  });
  return <AbsoluteFill style={{ background: blobs.join(", ") }} />;
};

/** Retro-future floor grid receding to a horizon (CSS 3D). */
export const PerspectiveGrid: React.FC<{ tint: string; scroll?: boolean }> = ({ tint, scroll = true }) => {
  const frame = useCurrentFrame();
  const off = scroll ? (frame * 1.2) % 80 : 0;
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

/** Floating dust motes caught in the key light — drawn on a single canvas (cheap to composite). */
const spriteCache: Record<string, HTMLCanvasElement> = {};
const dotSprite = (color: string) => {
  if (spriteCache[color]) return spriteCache[color];
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.35, `rgba(${color},0.45)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  spriteCache[color] = c;
  return c;
};

export const Dust: React.FC<{ count?: number; color?: string; speed?: number }> = ({ count = 70, color = "255,240,220", speed = 1 }) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 1920, 1080);
    const spr = dotSprite(color);
    for (let i = 0; i < count; i++) {
      const z = rand(i * 3.1);
      const size = (1.5 + z * 4.5) * (z > 0.75 ? 2.6 : 1.8);
      const x = ((rand(i) * 1920 + frame * (0.15 + z * 0.6) * speed + drift(frame, i, 12)) % 1980) - 30;
      const y = ((rand(i * 7.7) * 1080 - frame * (0.08 + z * 0.25) * speed + 1080 * 4) % 1100) - 10;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.03 + i));
      ctx.globalAlpha = Math.min(1, (0.2 + z * 0.6) * tw);
      ctx.drawImage(spr, x - size, y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  });
  return <canvas ref={ref} width={1920} height={1080} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
};
