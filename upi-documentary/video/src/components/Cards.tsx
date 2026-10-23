import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { clamp, ease, prog } from "../lib/anim";
import { Backdrop, Dust } from "./Backdrop";
import { Letterbox, LightLeak } from "./Film";
import { TL } from "../timeline";

const ROMAN = ["", "I", "II", "III", "IV"];

/** Chapter card: wide-tracked title that tightens as a light sweeps across it. */
export const ChapterCard: React.FC<{ num: number; en: string; hi: string; dur: number }> = ({ num, en, hi, dur }) => {
  const frame = useCurrentFrame();
  const inP = prog(frame, 0, 26, ease.out);
  const outP = prog(frame, dur - 12, 12, ease.in);
  const track = interpolate(frame, [0, dur], [0.62, 0.38], { ...clamp, easing: ease.soft });
  const sweep = interpolate(frame, [6, 52], [-30, 130], clamp);
  const scale = interpolate(frame, [0, dur], [1.04, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: 1 - outP }}>
      <Backdrop hue="neutral" light={0.6} />
      <Dust count={50} speed={0.6} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${scale})` }}>
        <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.6em", color: C.amber, opacity: prog(frame, 2, 14), marginBottom: 28 }}>
          CHAPTER {ROMAN[num]}
        </div>
        <div
          style={{
            fontFamily: F.wide,
            fontWeight: 300,
            fontSize: 150,
            letterSpacing: `${track}em`,
            paddingLeft: `${track}em`,
            color: C.ink,
            opacity: inP,
            filter: `blur(${(1 - inP) * 16}px)`,
            WebkitMaskImage: `linear-gradient(100deg, rgba(0,0,0,0.55) ${sweep - 25}%, #000 ${sweep}%, rgba(0,0,0,0.55) ${sweep + 25}%)`,
            textShadow: "0 0 60px rgba(255,255,255,0.12)",
            whiteSpace: "nowrap",
          }}
        >
          {en}
        </div>
        <div
          style={{
            fontFamily: F.hiSerif,
            fontSize: 74,
            color: C.inkDim,
            marginTop: 22,
            opacity: prog(frame, 12, 18),
            transform: `translateY(${(1 - prog(frame, 12, 18)) * 16}px)`,
          }}
        >
          {hi}
        </div>
        <div style={{ width: 520 * prog(frame, 8, 30), height: 1, background: `linear-gradient(90deg, transparent, ${C.amber}, transparent)`, marginTop: 40 }} />
      </AbsoluteFill>
      <LightLeak start={0} dur={dur} strength={0.35} />
      <Letterbox amount={1} />
    </AbsoluteFill>
  );
};

/** 3-second disclaimer card, right after the title. */
export const Disclaimer: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const op = Math.min(prog(frame, 0, 8), 1 - prog(frame, dur - 8, 8, ease.in));
  return (
    <AbsoluteFill style={{ background: "#020305", alignItems: "center", justifyContent: "center", opacity: op }}>
      <div style={{ width: 1360, textAlign: "center" }}>
        <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.5em", color: C.amber, marginBottom: 30 }}>DISCLAIMER · अस्वीकरण</div>
        <div style={{ fontFamily: F.hiBody, fontWeight: 500, fontSize: 40, lineHeight: 1.45, color: C.ink }}>{TL.disclaimer.hi}</div>
        <div style={{ height: 1, width: 300, margin: "30px auto", background: C.inkFaint }} />
        <div style={{ fontFamily: F.wide, fontWeight: 400, fontSize: 24, lineHeight: 1.55, color: C.inkDim, letterSpacing: "0.02em" }}>{TL.disclaimer.en}</div>
      </div>
    </AbsoluteFill>
  );
};
