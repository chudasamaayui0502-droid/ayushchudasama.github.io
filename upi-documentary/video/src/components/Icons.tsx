import React from "react";
import { useCurrentFrame } from "remotion";
import { prog, ease } from "../lib/anim";
import { C } from "../theme";

/** Line-art icons that draw themselves on (stroke-dash), After-Effects "trim path" style. */
const Draw: React.FC<{ d: string; start: number; dur?: number; color?: string; width?: number; len?: number }> = ({
  d,
  start,
  dur = 22,
  color = C.amber,
  width = 6,
  len = 1600,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, start, dur, ease.out);
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={len}
      strokeDashoffset={len * (1 - p)}
      style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}
    />
  );
};

export type IconName = "chai" | "fuel" | "rent" | "shop" | "bank" | "phone" | "server" | "shield" | "search" | "headset" | "train" | "tower" | "umbrella" | "govt" | "scale" | "gavel" | "person";

const PATHS: Record<IconName, string[]> = {
  chai: [
    "M60 70 L80 210 Q82 225 100 225 L160 225 Q178 225 180 210 L200 70 Z",
    "M66 110 L194 110",
    "M110 40 Q100 25 112 12 M140 44 Q130 28 142 14",
  ],
  fuel: [
    "M50 230 L50 50 Q50 30 70 30 L150 30 Q170 30 170 50 L170 230 Z",
    "M70 60 L150 60 L150 110 L70 110 Z",
    "M170 80 L200 80 Q215 80 215 95 L215 180 Q215 195 228 195 Q240 195 240 180 L240 70 L222 52",
    "M35 230 L185 230",
  ],
  rent: [
    "M40 120 L130 45 L220 120",
    "M65 100 L65 220 L195 220 L195 100",
    "M110 220 L110 160 L150 160 L150 220",
  ],
  shop: [
    "M40 90 L60 40 L200 40 L220 90 Z",
    "M40 90 Q57 115 75 90 Q92 115 110 90 Q127 115 145 90 Q162 115 180 90 Q197 115 220 90",
    "M55 110 L55 225 L205 225 L205 110",
    "M95 225 L95 160 L140 160 L140 225",
  ],
  bank: ["M30 100 L130 40 L230 100 Z", "M50 110 L50 200 M90 110 L90 200 M130 110 L130 200 M170 110 L170 200 M210 110 L210 200", "M30 215 L230 215"],
  phone: ["M85 20 L175 20 Q190 20 190 35 L190 225 Q190 240 175 240 L85 240 Q70 240 70 225 L70 35 Q70 20 85 20 Z", "M115 215 L145 215"],
  server: ["M50 40 L210 40 L210 100 L50 100 Z", "M50 120 L210 120 L210 180 L50 180 Z", "M75 70 L95 70 M75 150 L95 150 M170 70 L185 70 M170 150 L185 150", "M130 180 L130 225 M90 225 L170 225"],
  shield: ["M130 25 L215 60 L215 125 Q215 195 130 235 Q45 195 45 125 L45 60 Z", "M95 130 L122 157 L170 105"],
  search: ["M110 50 A60 60 0 1 0 110.1 50", "M155 155 L220 220"],
  headset: ["M60 150 L60 120 Q60 45 130 45 Q200 45 200 120 L200 150", "M45 140 L75 140 L75 200 L45 200 Z", "M185 140 L215 140 L215 200 L185 200 Z", "M200 200 Q200 230 150 230 L135 230"],
  train: ["M70 30 L190 30 Q210 30 210 50 L210 180 Q210 200 190 200 L70 200 Q50 200 50 180 L50 50 Q50 30 70 30 Z", "M50 120 L210 120", "M85 160 L95 160 M165 160 L175 160", "M80 200 L55 240 M180 200 L205 240"],
  tower: ["M130 60 L80 235 M130 60 L180 235 M100 165 L160 165 M92 200 L168 200", "M95 45 Q130 10 165 45 M75 30 Q130 -20 185 30"],
  umbrella: ["M30 130 Q130 10 230 130 Z", "M130 130 L130 210 Q130 235 105 235 Q85 235 85 215"],
  govt: ["M40 215 L220 215", "M60 200 L60 120 M100 200 L100 120 M160 200 L160 120 M200 200 L200 120", "M45 110 L215 110 L130 50 Z", "M130 50 L130 20 L160 30 L130 40"],
  scale: ["M130 30 L130 220 M70 220 L190 220", "M40 70 L220 70", "M40 70 L15 140 L65 140 Z M220 70 L195 140 L245 140 Z"],
  gavel: ["M60 120 L120 60 L160 100 L100 160 Z", "M130 130 L210 210", "M40 225 L140 225"],
  person: ["M130 40 A40 40 0 1 0 130.1 40", "M60 230 Q60 140 130 140 Q200 140 200 230"],
};

export const Icon: React.FC<{ name: IconName; start: number; size?: number; color?: string; width?: number; dur?: number; stagger?: number }> = ({
  name,
  start,
  size = 260,
  color = C.amber,
  width = 7,
  dur = 22,
  stagger = 5,
}) => (
  <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
    {PATHS[name].map((d, i) => (
      <Draw key={i} d={d} start={start + i * stagger} dur={dur} color={color} width={width} />
    ))}
  </svg>
);
