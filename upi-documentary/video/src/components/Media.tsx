import React from "react";
import { AbsoluteFill, Img, getStaticFiles, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, F } from "../theme";
import { clamp, drift } from "../lib/anim";

const has = (p: string) => getStaticFiles().some((f) => f.name === p);

/**
 * Real photo plate (public/photos/<name>.jpg) with a slow Ken-Burns push and drift.
 * Until the photo is added (next session, full network), the `fallback` art is shown.
 */
export const PhotoPlate: React.FC<{ name: string; fallback: React.ReactNode; dur: number; from?: number; to?: number; dim?: number }> = ({
  name,
  fallback,
  dur,
  from = 1.06,
  to = 1.16,
  dim = 0.45,
}) => {
  const frame = useCurrentFrame();
  const file = `photos/${name}.jpg`;
  if (!has(file)) return <>{fallback}</>;
  const s = interpolate(frame, [0, dur], [from, to], clamp);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={staticFile(file)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${s}) translate(${drift(frame, 4, 6)}px, ${drift(frame, 9, 4)}px)` }} />
      <AbsoluteFill style={{ background: `linear-gradient(rgba(4,6,11,${dim}), rgba(4,6,11,${dim + 0.25}))` }} />
    </AbsoluteFill>
  );
};

/**
 * A document page. Uses the real page image public/docs/<name>.png when present (cut from the official
 * PDF; `aspect` = its height / width, `highlight` in % of that image). Otherwise shows an unreadable
 * placeholder page that is clearly a stand-in, never a fake record.
 */
export const DocPage: React.FC<{ name: string; title: string; date: string; width?: number; aspect?: number; highlight?: { top: number; height: number; p: number } }> = ({
  name,
  title,
  date,
  width = 620,
  aspect,
  highlight,
}) => {
  const file = `docs/${name}.png`;
  const real = has(file);
  const h = width * (real && aspect ? aspect : 1.414);
  return (
    <div style={{ width, height: h, position: "relative", boxShadow: "0 50px 140px rgba(0,0,0,0.8)", background: "#efe7d6" }}>
      {real && (
        <div style={{ position: "absolute", left: 0, top: "100%", marginTop: 16, whiteSpace: "nowrap" }}>
          <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: "0.2em", color: C.amber }}>{date}</div>
          <div style={{ fontFamily: F.hiBody, fontSize: 22, fontWeight: 600, color: C.ink }}>{title}</div>
        </div>
      )}
      {real ? (
        <Img src={staticFile(file)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <>
          <Img src={staticFile("tex/paper.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: "8% 9%", filter: "blur(2.2px)" }}>
            <div style={{ height: 18, width: "50%", margin: "0 auto 30px", background: "rgba(29,26,22,0.55)" }} />
            {Array.from({ length: 26 }).map((_, i) => (
              <div key={i} style={{ height: 9, marginTop: 15, width: `${i % 6 === 5 ? 55 : 92 + ((i * 37) % 8)}%`, background: "rgba(29,26,22,0.32)" }} />
            ))}
          </div>
        </>
      )}
      {highlight && (
        <div
          style={{
            position: "absolute",
            left: "7%",
            top: `${highlight.top}%`,
            height: `${highlight.height}%`,
            width: `${86 * highlight.p}%`,
            background: "rgba(255,190,60,0.42)",
            mixBlendMode: "multiply",
          }}
        />
      )}
      {!real && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 22px", background: "rgba(10,12,18,0.88)", color: C.ink }}>
          <div style={{ fontFamily: F.mono, fontSize: 16, letterSpacing: "0.18em", color: C.amber }}>{date}</div>
          <div style={{ fontFamily: F.hiBody, fontSize: 26, fontWeight: 600 }}>{title}</div>
          <div style={{ fontFamily: F.mono, fontSize: 13, letterSpacing: "0.1em", color: C.inkDim }}>OFFICIAL DOCUMENT · LINK IN DESCRIPTION</div>
        </div>
      )}
    </div>
  );
};
