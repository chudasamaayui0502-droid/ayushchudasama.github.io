import raw from "./timeline.json";

export type Line = {
  id: string;
  display: string;
  en: string;
  src: string;
  from: number;
  frames: number;
};

export type Seg = {
  kind: "scene" | "title" | "disclaimer" | "chapter" | "black";
  id: string;
  chapter?: string;
  from: number;
  frames: number;
  lines?: Line[];
  num?: number;
  name_en?: string;
  name_hi?: string;
};

export const TL = raw as unknown as {
  fps: number;
  frames: number;
  seconds: number;
  voDir: string;
  title_hi: string;
  title_en: string;
  disclaimer: { hi: string; en: string };
  segments: Seg[];
};

export const segById = (id: string) => {
  const s = TL.segments.find((x) => x.id === id);
  if (!s) throw new Error(`segment ${id} missing from timeline`);
  return s;
};

/** Line timings relative to the start of their segment: L.c1_04.at / .end / .len */
export const relLines = (seg: Seg) => {
  const out: Record<string, { at: number; end: number; len: number; display: string }> = {};
  for (const l of seg.lines ?? []) {
    out[l.id] = { at: l.from - seg.from, end: l.from - seg.from + l.frames, len: l.frames, display: l.display };
  }
  return out;
};

export type SceneProps = { seg: Seg };
