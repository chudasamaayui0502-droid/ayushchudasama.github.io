import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, useCurrentFrame } from "remotion";
import { HITS, TLS, Seg, Timeline } from "./timeline";
import { Lang, LangCtx } from "./lang";
import { SCENES } from "./scenes";
import { ChapterCard, Disclaimer } from "./components/Cards";
import { Film, Flash, GlobalLetterbox, Letterbox } from "./components/Film";
import { TransitionLayer } from "./components/Transitions";
import { clamp, drift, ease, prog, rand } from "./lib/anim";
import { C, F } from "./theme";
import { loadFonts } from "./fonts";
import { getAudioUrl } from "./audio";

loadFonts();

const renderSeg = (seg: Seg) => {
  if (seg.kind === "chapter") return <ChapterCard num={seg.num ?? 1} en={seg.name_en ?? ""} hi={seg.name_hi ?? ""} dur={seg.frames} />;
  if (seg.kind === "disclaimer") return <Disclaimer dur={seg.frames} />;
  if (seg.kind === "black") return <AbsoluteFill style={{ background: "#000" }} />;
  const Comp = SCENES[seg.id];
  if (!Comp) return <AbsoluteFill style={{ background: "#300", color: "#fff", fontSize: 60 }}>missing scene {seg.id}</AbsoluteFill>;
  return <Comp seg={seg} />;
};

/** Camera punch-in + a short shake on every big musical hit (times come from the score). */
const Punch: React.FC<{ lang: Lang; children: React.ReactNode }> = ({ lang, children }) => {
  const frame = useCurrentFrame();
  let s = 0;
  let x = 0;
  let y = 0;
  for (const [h, k] of HITS[lang]) {
    const d = frame - h;
    if (d < -1 || d > 24) continue;
    const env = d < 1 ? (d + 1) / 2 : Math.exp(-(d - 1) / 5);
    s += 0.032 * k * env;
    if (d >= 0 && d < 12) {
      const sh = 16 * k * Math.exp(-d / 3.5);
      x += (rand(h * 3 + d) - 0.5) * sh;
      y += (rand(h * 7 + d + 0.5) - 0.5) * sh * 0.6;
    }
  }
  s = Math.min(s, 0.06);
  if (s < 0.0005 && Math.abs(x) < 0.05) return <AbsoluteFill>{children}</AbsoluteFill>;
  // scale enough to keep the frame edges covered while shaking
  const cover = 1 + s + (Math.abs(x) + Math.abs(y)) / 900;
  return <AbsoluteFill style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${cover.toFixed(4)})` }}>{children}</AbsoluteFill>;
};

/** A slow camera push + handheld drift on every scene, so even the stillest frame keeps moving. */
const SceneCam: React.FC<{ span: number; seed: number; children: React.ReactNode }> = ({ span, seed, children }) => {
  const frame = useCurrentFrame();
  const s = 1 + 0.03 * ease.soft(Math.min(1, frame / Math.max(1, span)));
  const x = drift(frame, seed * 1.7, 5);
  const y = drift(frame, seed * 2.3 + 1, 3);
  return <AbsoluteFill style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})` }}>{children}</AbsoluteFill>;
};

/** The 0.45 scene letterbox, drawn once above all scenes (not for the full-frame cold open). */
const SceneBars: React.FC<{ TL: Timeline }> = ({ TL }) => {
  const frame = useCurrentFrame();
  const on = TL.segments.some((s, i) => {
    const next = TL.segments[i + 1];
    const end = next ? next.from : s.from + s.frames;
    return s.kind === "scene" && s.id !== "S00_ColdOpen" && frame >= s.from && frame < end;
  });
  return on ? <Letterbox amount={0.45} force /> : null;
};

const ROMAN = ["", "I", "II", "III", "IV"];

/** Small chapter tag in the top letterbox band, with a progress line through the chapter. */
const ChapterHUD: React.FC<{ TL: Timeline }> = ({ TL }) => {
  const frame = useCurrentFrame();
  const cards = TL.segments.filter((s) => s.kind === "chapter");
  const black = TL.segments.find((s) => s.kind === "black");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const a = card.from + card.frames + 24;
    const b = i + 1 < cards.length ? cards[i + 1].from : (black?.from ?? TL.frames);
    if (frame < a - 2 || frame >= b) continue;
    const p = prog(frame, a, 18, ease.out);
    const q = 1 - prog(frame, b - 14, 12, ease.in);
    const fill = interpolate(frame, [a, b], [0, 1], clamp);
    const sub = card.name_hi; // Hindi name, or the English subtitle in the English edition
    return (
      <div style={{ position: "absolute", left: 64, top: 22, opacity: p * q, display: "flex", alignItems: "center", gap: 14, pointerEvents: "none" }}>
        <div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: "0.32em", color: C.amber, transform: `translateX(${(1 - p) * -24}px)` }}>
          {ROMAN[card.num ?? 1]}
        </div>
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: "0.3em", color: C.inkDim, whiteSpace: "nowrap", transform: `translateY(${(1 - p) * 110}%)` }}>
            {card.name_en}
            {sub ? <span style={{ fontFamily: TL.lang === "en" ? F.mono : F.hiBody, letterSpacing: TL.lang === "en" ? "0.3em" : "0.04em", fontSize: TL.lang === "en" ? 15 : 18, color: C.inkFaint }}>{"  ·  " + sub}</span> : null}
          </div>
          <div style={{ marginTop: 6, height: 1, width: 300, background: "rgba(242,239,232,0.12)" }}>
            <div style={{ height: 1, width: `${fill * 100}%`, background: C.amber, boxShadow: `0 0 8px ${C.amber}` }} />
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export const Main: React.FC<{ lang?: Lang }> = ({ lang = "hi" }) => {
  const TL = TLS[lang];
  const mix = getAudioUrl(lang);
  return (
    <LangCtx.Provider value={lang}>
      <GlobalLetterbox.Provider value={true}>
      <AbsoluteFill style={{ background: "#000" }}>
        <Punch lang={lang}>
          {TL.segments.map((seg, i) => {
            // Scene starts snap to the music's 0.5 s grid; hold each segment until the next one begins so no gap shows black.
            const next = TL.segments[i + 1];
            const span = next ? Math.max(seg.frames, next.from - seg.from) : seg.frames;
            const outTr = seg.kind !== "black" ? next?.trans_in : undefined;
            return (
              <Sequence key={seg.id} from={seg.from} durationInFrames={span + (outTr?.frames ?? 0)} name={seg.id}>
                <TransitionLayer id={seg.id} span={span} inTr={seg.trans_in} outTr={outTr}>
                  {seg.kind === "scene" && seg.id !== "S00_ColdOpen" ? (
                    <SceneCam span={span} seed={i}>
                      {renderSeg(seg)}
                    </SceneCam>
                  ) : (
                    renderSeg(seg)
                  )}
                </TransitionLayer>
              </Sequence>
            );
          })}
        </Punch>
        {/* white flashes on the big hits */}
        {TL.segments
          .filter((s) => s.kind === "title" || s.kind === "chapter")
          .map((s) => (
            <Flash key={`f-${s.id}`} at={s.from} len={s.kind === "title" ? 14 : 9} peak={s.kind === "title" ? 0.9 : 0.5} />
          ))}
        <SceneBars TL={TL} />
        <ChapterHUD TL={TL} />
        <Film />
        {mix && <Audio src={mix} />}
      </AbsoluteFill>
      </GlobalLetterbox.Provider>
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
