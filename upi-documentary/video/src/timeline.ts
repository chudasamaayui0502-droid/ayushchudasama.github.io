import { useContext } from "react";
import rawHi from "./timeline.json";
import rawEn from "./timeline_en.json";
import beatsHi from "./data/beats_hi.json";
import beatsEn from "./data/beats_en.json";
import hitsHi from "./data/hits.json";
import hitsEn from "./data/hits_en.json";
import { Lang, LangCtx } from "./lang";
import type { Trans } from "./components/Transitions";

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
  lang?: Lang;
  trans_in?: Trans & { from_scene: boolean; t_mid: number };
};

export type Timeline = {
  lang: Lang;
  fps: number;
  frames: number;
  seconds: number;
  voDir: string;
  title_hi: string;
  title_en: string;
  facts_as_of: string;
  disclaimer: { hi: string; en: string };
  segments: Seg[];
};

const load = (raw: unknown, lang: Lang): Timeline => {
  const tl = raw as Timeline;
  return { ...tl, lang, segments: tl.segments.map((s) => ({ ...s, lang })) };
};

export const TLS: Record<Lang, Timeline> = { hi: load(rawHi, "hi"), en: load(rawEn, "en") };
/** Hindi timeline (default edition). Prefer useTL() inside components. */
export const TL = TLS.hi;

export const useTL = () => TLS[useContext(LangCtx)];

/** Musical hits written by music/score.py: [frame, strength 0..1] — drive the camera punch. */
export const HITS: Record<Lang, [number, number][]> = {
  hi: hitsHi as unknown as [number, number][],
  en: hitsEn as unknown as [number, number][],
};

const BEATS: Record<Lang, Record<string, Record<string, number>>> = {
  hi: beatsHi as unknown as Record<string, Record<string, number>>,
  en: beatsEn as unknown as Record<string, Record<string, number>>,
};

/** Word-position fraction for a line, re-synced to that edition's final voice (tools/align_beats.py). */
export const beatFrac = (lang: Lang | undefined, lineId: string, f: number) => BEATS[lang ?? "hi"][lineId]?.[String(f)] ?? f;

/** Line timings relative to the start of their segment: L.c1_04.at / .end / .len / .fr(0.6) */
export const relLines = (seg: Seg) => {
  const out: Record<string, { at: number; end: number; len: number; display: string; fr: (f: number) => number }> = {};
  for (const l of seg.lines ?? []) {
    out[l.id] = {
      at: l.from - seg.from,
      end: l.from - seg.from + l.frames,
      len: l.frames,
      display: l.display,
      fr: (f: number) => beatFrac(seg.lang, l.id, f),
    };
  }
  return out;
};

export type SceneProps = { seg: Seg };
