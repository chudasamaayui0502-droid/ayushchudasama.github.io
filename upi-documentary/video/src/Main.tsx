import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { TLS, Seg } from "./timeline";
import { Lang, LangCtx } from "./lang";
import { SCENES } from "./scenes";
import { ChapterCard, Disclaimer } from "./components/Cards";
import { Film, Flash } from "./components/Film";
import { clamp, ease } from "./lib/anim";
import { loadFonts } from "./fonts";
import { getAudioUrl } from "./audio";

loadFonts();

const OVERLAP = 12; // frames of zoom-through dissolve between segments

/** Entry: push in from slight blur; exit: zoom past camera and dissolve. */
const Transition: React.FC<{ seg: Seg; children: React.ReactNode; hardIn?: boolean }> = ({ seg, children, hardIn }) => {
  const frame = useCurrentFrame();
  const inT = hardIn ? 1 : interpolate(frame, [0, OVERLAP], [0, 1], { ...clamp, easing: ease.out });
  const outT = interpolate(frame, [seg.frames, seg.frames + OVERLAP], [0, 1], { ...clamp, easing: ease.in });
  const scale = (1 + (1 - inT) * 0.06) * (1 + outT * 0.12);
  const blur = (1 - inT) * 12 + outT * 18;
  return (
    <AbsoluteFill style={{ opacity: inT * (1 - outT), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>
      {children}
    </AbsoluteFill>
  );
};

const renderSeg = (seg: Seg) => {
  if (seg.kind === "chapter") return <ChapterCard num={seg.num ?? 1} en={seg.name_en ?? ""} hi={seg.name_hi ?? ""} dur={seg.frames} />;
  if (seg.kind === "disclaimer") return <Disclaimer dur={seg.frames} />;
  if (seg.kind === "black") return <AbsoluteFill style={{ background: "#000" }} />;
  const Comp = SCENES[seg.id];
  if (!Comp) return <AbsoluteFill style={{ background: "#300", color: "#fff", fontSize: 60 }}>missing scene {seg.id}</AbsoluteFill>;
  return <Comp seg={seg} />;
};

export const Main: React.FC<{ lang?: Lang }> = ({ lang = "hi" }) => {
  const TL = TLS[lang];
  const mix = getAudioUrl(lang);
  return (
    <LangCtx.Provider value={lang}>
    <AbsoluteFill style={{ background: "#000" }}>
      {TL.segments.map((seg, i) => {
        // Hard cuts (no dissolve) into: title, disclaimer, black, chapter cards.
        const hard = seg.kind !== "scene";
        // Scene starts snap to the music's 0.5 s grid; hold each segment until the next one begins so no gap shows black.
        const next = TL.segments[i + 1];
        const span = next ? Math.max(seg.frames, next.from - seg.from) : seg.frames;
        const held = { ...seg, frames: span };
        return (
          <Sequence key={seg.id} from={seg.from} durationInFrames={span + (seg.kind === "black" ? 0 : OVERLAP)} name={seg.id}>
            <Transition seg={held} hardIn={hard}>
              {renderSeg(seg)}
            </Transition>
          </Sequence>
        );
      })}
      {/* white flashes on the big hits */}
      {TL.segments
        .filter((s) => s.kind === "title" || s.kind === "chapter")
        .map((s) => (
          <Flash key={`f-${s.id}`} at={s.from} len={s.kind === "title" ? 14 : 9} peak={s.kind === "title" ? 0.9 : 0.5} />
        ))}
      <Film />
      {mix && <Audio src={mix} />}
    </AbsoluteFill>
    </LangCtx.Provider>
  );
};

/** Render a single segment on its own (for previews / stills). */
export const SegmentPreview: React.FC<{ id: string; lang?: Lang }> = ({ id, lang = "hi" }) => {
  const seg = TLS[lang].segments.find((s) => s.id === id)!;
  return (
    <LangCtx.Provider value={lang}>
      <AbsoluteFill style={{ background: "#000" }}>
        {renderSeg(seg)}
        <Film />
        <PreviewAudio seg={seg} lang={lang} />
      </AbsoluteFill>
    </LangCtx.Provider>
  );
};

const PreviewAudio: React.FC<{ seg: Seg; lang: Lang }> = ({ seg, lang }) => {
  const mix = getAudioUrl(lang);
  if (!mix) return null;
  return <Audio src={mix} trimBefore={seg.from} />;
};
