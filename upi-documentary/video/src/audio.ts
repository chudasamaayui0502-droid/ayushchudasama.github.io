import { getStaticFiles, staticFile } from "remotion";
import type { Lang } from "./lang";

/** The final mix lives at public/audio/mix.wav (Hindi) / mix_en.wav (English), built by tools/mix.py. */
export const getAudioUrl = (lang: Lang = "hi"): string | null => {
  const name = lang === "en" ? "audio/mix_en.wav" : "audio/mix.wav";
  return getStaticFiles().some((f) => f.name === name) ? staticFile(name) : null;
};
