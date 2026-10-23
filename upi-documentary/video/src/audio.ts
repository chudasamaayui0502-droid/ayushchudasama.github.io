import { getStaticFiles, staticFile } from "remotion";

/** The final mix lives at public/audio/mix.wav (built by tools/mix.py). */
export const getAudioUrl = (): string | null => {
  const has = getStaticFiles().some((f) => f.name === "audio/mix.wav");
  return has ? staticFile("audio/mix.wav") : null;
};
