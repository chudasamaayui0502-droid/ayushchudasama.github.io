// Visual language: teal = the system / digital, amber = money / the bill,
// red = warning / conflict, bone-white = narration text. Everything sits on near-black.
export const C = {
  bg: "#04060b",
  bg2: "#0a0f1a",
  ink: "#f2efe8",
  inkDim: "rgba(242,239,232,0.62)",
  inkFaint: "rgba(242,239,232,0.28)",
  teal: "#2ee6d6",
  tealDeep: "#0c6f74",
  amber: "#ffa53a",
  amberDeep: "#b3560f",
  red: "#ff3b3b",
  green: "#3ddc84",
  paper: "#efe7d6",
  paperInk: "#1d1a16",
} as const;

export const F = {
  // Devanagari + Latin
  hiDisplay: "'Teko', 'Mukta', sans-serif",
  hiBody: "'Mukta', 'Noto Sans Devanagari', sans-serif",
  hiSerif: "'Tiro Devanagari Hindi', 'Noto Serif Devanagari', serif",
  // Latin
  wide: "'Montserrat', sans-serif",
  serif: "'Cormorant Garamond', serif",
  mono: "'IBM Plex Mono', monospace",
} as const;

export const FPS = 30;
export const W = 1920;
export const H = 1080;
