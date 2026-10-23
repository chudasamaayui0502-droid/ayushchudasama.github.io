import { Easing, interpolate } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Cinematic curves: slow-in/slow-out for camera, sharp-out for type.
export const ease = {
  cam: Easing.bezier(0.65, 0, 0.35, 1),
  out: Easing.bezier(0.16, 1, 0.3, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  snap: Easing.bezier(0.85, 0, 0.15, 1),
  soft: Easing.bezier(0.33, 1, 0.68, 1),
};

/** 0→1 over [start, start+dur] with an easing curve. */
export const prog = (frame: number, start: number, dur: number, curve = ease.out) =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], { ...clamp, easing: curve });

/** Fade in at `start`, hold, fade out ending at `end`. */
export const window01 = (frame: number, start: number, end: number, fadeIn = 10, fadeOut = 10) =>
  Math.min(prog(frame, start, fadeIn, ease.soft), 1 - prog(frame, end - fadeOut, fadeOut, ease.in));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Keyframed value: keys = [[frame, value], ...], eased between keys. */
export const keys = (frame: number, ks: [number, number][], curve = ease.cam) => {
  if (frame <= ks[0][0]) return ks[0][1];
  for (let i = 0; i < ks.length - 1; i++) {
    const [f0, v0] = ks[i];
    const [f1, v1] = ks[i + 1];
    if (frame <= f1) return lerp(v0, v1, curve((frame - f0) / Math.max(1, f1 - f0)));
  }
  return ks[ks.length - 1][1];
};

// Deterministic pseudo-random (no Math.random in renders).
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Smooth handheld drift, in pixels/units, deterministic per seed. */
export const drift = (frame: number, seed = 1, amp = 1) =>
  amp *
  (Math.sin(frame * 0.021 + seed) * 0.6 + Math.sin(frame * 0.047 + seed * 2.1) * 0.3 + Math.sin(frame * 0.11 + seed * 3.7) * 0.1);

/** Indian digit grouping: 2407000000 -> 2,40,70,00,000 */
export const inr = (n: number) => {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
};
