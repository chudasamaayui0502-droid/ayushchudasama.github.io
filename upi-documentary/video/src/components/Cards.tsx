import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { C, F } from "../theme";
import { clamp, ease, prog } from "../lib/anim";
import { Backdrop, Dust, PerspectiveGrid } from "./Backdrop";
import { Letterbox, LightLeak } from "./Film";
import { useTL } from "../timeline";

const ROMAN = ["", "I", "II", "III", "IV"];

/** Chapter card: giant parallax numeral, letter-by-letter title, light sweep, slow 3D settle. */
export const ChapterCard: React.FC<{ num: number; en: string; hi: string; dur: number }> = ({ num, en, hi, dur }) => {
  const frame = useCurrentFrame();
  const lang = useLang();
  const track = interpolate(frame, [0, dur], [0.5, 0.34], { ...clamp, easing: ease.soft });
  const sweep = interpolate(frame, [10, 60], [-30, 130], clamp);
  const settle = prog(frame, 0, dur, ease.soft);
  const rotY = interpolate(settle, [0, 1], [7, -2]);
  const scale = interpolate(frame, [0, dur], [1.05, 1], clamp);
  const label = `CHAPTER ${ROMAN[num]}`;
  const typed = Math.floor(interpolate(frame, [2, 2 + label.length * 1.2], [0, label.length], clamp));
  const lineP = prog(frame, 10, 26, ease.out);
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.65} />
      <PerspectiveGrid tint="255,165,58" />
      <Dust count={50} speed={0.6} />
      {/* the numeral, huge and behind, drifting the other way (parallax) */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: F.hiDisplay,
            fontSize: 820,
            lineHeight: 1,
            color: "transparent",
            WebkitTextStroke: "2px rgba(255,165,58,0.2)",
            transform: `translateX(${interpolate(frame, [0, dur], [140, -60])}px) scale(${interpolate(frame, [0, dur], [1.12, 1])})`,
            opacity: prog(frame, 0, 14),
            WebkitMaskImage: `linear-gradient(100deg, rgba(0,0,0,0.5) ${sweep - 30}%, #000 ${sweep}%, rgba(0,0,0,0.5) ${sweep + 30}%)`,
          }}
        >
          {ROMAN[num]}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ perspective: 1600 }}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `rotateY(${rotY}deg) scale(${scale})` }}>
          <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.6em", paddingLeft: "0.6em", color: C.amber, marginBottom: 28, whiteSpace: "pre" }}>
            {label.slice(0, typed)}
            <span style={{ opacity: typed < label.length ? 1 : 0 }}>▌</span>
          </div>
          <div
            style={{
              fontFamily: F.wide,
              fontWeight: 300,
              // long names shrink so the widest (most tracked-out) moment still fits inside the frame
              fontSize: Math.min(150, 1640 / (en.length * (0.66 + 0.5))),
              letterSpacing: `${track}em`,
              paddingLeft: `${track}em`,
              color: C.ink,
              WebkitMaskImage: `linear-gradient(100deg, rgba(0,0,0,0.6) ${sweep - 25}%, #000 ${sweep}%, rgba(0,0,0,0.6) ${sweep + 25}%)`,
              textShadow: "0 0 60px rgba(255,255,255,0.12)",
              whiteSpace: "nowrap",
              display: "flex",
            }}
          >
            {en.split("").map((ch, i) => {
              const p = prog(frame, 4 + i * 1.6, 14, ease.out);
              return (
                <span key={i} style={{ display: "inline-block", overflow: "hidden", padding: "0.1em 0", margin: "-0.1em 0" }}>
                  <span
                    style={{
                      display: "inline-block",
                      whiteSpace: "pre",
                      transform: `translateY(${(1 - p) * 110}%)`,
                      opacity: Math.min(1, p * 1.5),
                      filter: p < 1 ? `blur(${(1 - p) * 6}px)` : undefined,
                    }}
                  >
                    {ch}
                  </span>
                </span>
              );
            })}
          </div>
          <div style={{ overflow: "hidden", padding: "0.2em 0", marginTop: 12 }}>
            <div
              style={{
                fontFamily: lang === "en" ? F.serif : F.hiSerif,
                fontStyle: lang === "en" ? "italic" : undefined,
                fontSize: lang === "en" ? 66 : 74,
                color: C.inkDim,
                transform: `translateY(${(1 - prog(frame, 14, 16, ease.out)) * 110}%)`,
              }}
            >
              {hi}
            </div>
          </div>
          <div style={{ position: "relative", width: 640, height: 2, marginTop: 34 }}>
            <div style={{ position: "absolute", left: `${50 - 50 * lineP}%`, right: `${50 - 50 * lineP}%`, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${C.amber}, transparent)` }} />
            <div
              style={{
                position: "absolute",
                top: -3,
                left: `${interpolate(frame, [14, 70], [8, 92], clamp)}%`,
                width: 7,
                height: 7,
                borderRadius: 4,
                background: "#fff",
                boxShadow: `0 0 14px 4px ${C.amber}`,
                opacity: lineP * (1 - prog(frame, 60, 14)),
              }}
            />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      <LightLeak start={0} dur={dur} strength={0.35} />
      <Letterbox amount={1} />
    </AbsoluteFill>
  );
};

/** 3-second disclaimer card, right after the title. */
export const Disclaimer: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const TL = useTL();
  const t = useT();
  const lang = useLang();
  const op = Math.min(prog(frame, 0, 8), 1 - prog(frame, dur - 8, 8, ease.in));
  return (
    <AbsoluteFill style={{ background: "#020305", alignItems: "center", justifyContent: "center", opacity: op }}>
      <div style={{ width: 1360, textAlign: "center" }}>
        <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.5em", color: C.amber, marginBottom: 30 }}>{t("DISCLAIMER · अस्वीकरण", "DISCLAIMER")}</div>
        <div style={{ fontFamily: F.hiBody, fontWeight: 500, fontSize: 40, lineHeight: 1.45, color: C.ink }}>{TL.disclaimer.hi}</div>
        {TL.disclaimer.en && (
          <>
            <div style={{ height: 1, width: 300, margin: "30px auto", background: C.inkFaint }} />
            <div style={{ fontFamily: F.wide, fontWeight: 400, fontSize: 24, lineHeight: 1.55, color: C.inkDim, letterSpacing: "0.02em" }}>{TL.disclaimer.en}</div>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};
