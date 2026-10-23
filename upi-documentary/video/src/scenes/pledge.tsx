import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { Line as DreiLine } from "@react-three/drei";
import { SceneProps, relLines } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Counter, Dateline, Source, Stamp, Words } from "../components/Type";
import { Icon } from "../components/Icons";
import { Layer, ParallaxWorld } from "../components/Parallax";
import { CamRig, GlowNode, Halo, QRBlocks, QR_TEXT, RupeeField, Stage, qrMatrix } from "../three/kit";

/* ---------------------------------------------------------------- S11 */
const PART_CARDS = [
  { n: "I", en: "THE PLEDGE", hi: "वादा", glyph: "●" },
  { n: "II", en: "THE TURN", hi: "ग़ायब", glyph: "◌" },
  { n: "III", en: "THE PRESTIGE", hi: "वापसी", glyph: "◉" },
];

export const S11_ThreeParts: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const focus = prog(frame, L.c1_02.at, 30, ease.cam);
  const cam = {
    x: keys(frame, [[0, -260], [L.c1_02.at, 60], [seg.frames, -330]]),
    y: drift(frame, 2, 8),
    z: keys(frame, [[0, -200], [L.c1_02.at, 0], [seg.frames, 380]]),
    ry: keys(frame, [[0, 7], [seg.frames, -4]]),
  };
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.7} />
      <ParallaxWorld cam={cam}>
        {PART_CARDS.map((c, i) => {
          const appear = prog(frame, L.c1_01.at + i * 9, 18, ease.out);
          const active = i === 0 ? 1 : 1 - focus * 0.7;
          const glow = i === 0 ? focus : 0;
          return (
            <Layer key={c.n} z={-i * 90} x={(i - 1) * 560} y={-40 + (1 - appear) * 80} opacity={appear * active}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div
                  style={{
                    width: 420,
                    height: 600,
                    borderRadius: 18,
                    border: `1.5px solid ${glow > 0.1 ? C.amber : "rgba(242,239,232,0.22)"}`,
                    background: "linear-gradient(160deg, rgba(20,26,40,0.92), rgba(6,8,14,0.95))",
                    boxShadow: `0 40px 120px rgba(0,0,0,0.7), 0 0 ${80 * glow}px rgba(255,165,58,${0.45 * glow})`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 18,
                  }}
                >
                  <div style={{ fontFamily: F.serif, fontSize: 70, color: C.amber, lineHeight: 1 }}>{c.n}</div>
                  <div style={{ fontSize: 120, color: glow > 0.1 ? C.amber : C.inkDim, lineHeight: 1, textShadow: `0 0 40px rgba(255,165,58,${glow})` }}>{c.glyph}</div>
                  <div style={{ fontFamily: F.wide, fontWeight: 300, fontSize: 34, letterSpacing: "0.32em", paddingLeft: "0.32em", color: C.ink }}>{c.en}</div>
                  <div style={{ fontFamily: F.hiSerif, fontSize: 52, color: C.inkDim }}>{c.hi}</div>
                </div>
              </AbsoluteFill>
            </Layer>
          );
        })}
      </ParallaxWorld>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 110 }}>
        <Sequence durationInFrames={L.c1_02.at} layout="none">
          <Words text="हर जादू के *तीन हिस्से* होते हैं।" start={L.c1_01.at} size={60} />
        </Sequence>
        <Sequence from={L.c1_02.at} layout="none">
          <Words text="पहला हिस्सा — *वादा।*|जादूगर आपको एक आम सी चीज़ दिखाता है।" start={2} size={56} />
        </Sequence>
      </AbsoluteFill>
      <Dust count={50} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S12 */
export const S12_QR: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const reveal = prog(frame, L.c1_03.at + L.c1_03.len * 0.55, 40, ease.out);
  const ang = keys(frame, [[0, -0.9], [seg.frames, 0.25]]);
  const elev = keys(frame, [[0, 0.25], [seg.frames, 0.9]]);
  const r = keys(frame, [[0, 13], [seg.frames, 9.5]]);
  return (
    <AbsoluteFill>
      <Backdrop hue="teal" light={0.6} />
      <Stage>
        <CamRig pos={[Math.sin(ang) * r * Math.cos(elev), -Math.cos(ang) * r * Math.cos(elev) * 0.25 + Math.sin(elev) * r * 0.2, Math.cos(ang) * r]} target={[0, 0, 0.3]} />
        <ambientLight intensity={0.15} />
        <spotLight position={[0, 6, 8]} angle={0.45} penumbra={0.9} intensity={260 * (0.3 + reveal)} color="#fff2dc" />
        <pointLight position={[-5, -3, 2]} intensity={30} color={C.teal} />
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#0a0d14" roughness={0.6} metalness={0.4} />
        </mesh>
        <Halo position={[0, 0, -0.5]} size={10} color={C.teal} opacity={0.25 + reveal * 0.35} />
        <QRBlocks cells={cells} rise={reveal} size={4.4} color="#f2efe8" emissive={0.12 + reveal * 0.25} />
      </Stage>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 45% 30% at 18% 12%, rgba(4,6,11,0.85), rgba(4,6,11,0) 100%)" }} />
      <AbsoluteFill style={{ padding: "120px 140px", justifyContent: "flex-start" }}>
        <Words text="हमारी कहानी में वो आम सी चीज़ है..." start={L.c1_03.at} size={52} align="left" color={C.inkDim} weight={500} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "flex-end", padding: "0 160px 140px" }}>
        <Words text="*ये।*" start={L.c1_03.at + Math.round(L.c1_03.len * 0.62)} size={170} font={F.hiDisplay} mode="punch" accent={C.ink} />
      </AbsoluteFill>
      <Flash at={L.c1_03.at + Math.round(L.c1_03.len * 0.62)} peak={0.25} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S13 */
const BankRing: React.FC<{ lit: number; frame: number }> = ({ lit, frame }) => {
  const nodes = useMemo(() => Array.from({ length: 21 }, (_, i) => {
    const a = (i / 21) * Math.PI * 2;
    return [Math.cos(a) * 4.2, Math.sin(a) * 4.2 * 0.55, Math.sin(a) * 1.2] as [number, number, number];
  }), []);
  return (
    <group rotation={[0.35, frame * 0.002, 0]}>
      <GlowNode position={[0, 0, 0]} size={0.7} on={0.6 + lit * 0.4} />
      {nodes.map((p, i) => {
        const on = Math.max(0, Math.min(1, lit * 21 - i));
        return (
          <group key={i}>
            <GlowNode position={p} size={0.16} color={on > 0.5 ? C.amber : "#3a4252"} on={on} />
            {on > 0.01 && <DreiLine points={[[0, 0, 0], p]} color={C.teal} lineWidth={1.2} transparent opacity={0.15 + on * 0.5} />}
          </group>
        );
      })}
    </group>
  );
};

export const S13_Launch: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const lit = prog(frame, L.c1_04.at + L.c1_04.len * 0.45, L.c1_04.len * 0.5, ease.soft);
  const shrink = prog(frame, L.c1_05.at, 20, ease.cam);
  return (
    <AbsoluteFill>
      <Backdrop hue="teal" light={0.8} />
      <AbsoluteFill style={{ transform: `translateX(${-shrink * 380}px) scale(${1 - shrink * 0.25})` }}>
        <Stage>
          <CamRig pos={[drift(frame, 3, 0.4), 1.2, keys(frame, [[0, 15], [seg.frames, 11.5]])]} />
          <ambientLight intensity={0.3} />
          <BankRing lit={lit} frame={frame} />
        </Stage>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: F.mono, fontSize: 28, color: C.teal, letterSpacing: "0.4em", marginTop: 250, opacity: prog(frame, 20, 15), textShadow: "0 0 20px rgba(0,0,0,0.9)" }}>NPCI</div>
        </AbsoluteFill>
      </AbsoluteFill>
      <Dateline en="AUG 2016" hi="अगस्त 2016" start={L.c1_04.at} out={seg.frames - 14} />
      <div style={{ position: "absolute", right: 150, top: 150, textAlign: "right", opacity: lit }}>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 150, color: C.amber, lineHeight: 1 }}>{Math.round(lit * 21)}</div>
        <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.3em", color: C.inkDim }}>BANKS · बैंक</div>
      </div>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 110, opacity: 1 - shrink }}>
        <Words text="NPCI का नया system — *Unified Payments Interface*" start={L.c1_04.at + 10} size={50} accent={C.teal} />
      </AbsoluteFill>
      {/* c1_05: the tiny first month */}
      <Sequence from={L.c1_05.at} layout="none">
        <div style={{ position: "absolute", right: 150, top: 380, width: 760 }}>
          <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.28em", color: C.inkDim }}>FIRST FULL MONTH · पहला महीना</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 10 }}>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.ink, lineHeight: 1 }}>{"<"}</div>
            <Counter to={1000000} start={6} dur={30} size={130} />
          </div>
          <div style={{ fontFamily: F.hiBody, fontSize: 40, color: C.inkDim, marginTop: 4 }}>transactions — पूरे महीने में</div>
          <div style={{ marginTop: 30, height: 18, width: 760, background: "rgba(242,239,232,0.08)", borderRadius: 9 }}>
            <div style={{ height: 18, width: 4 + prog(frame - L.c1_05.at, 10, 20) * 6, background: C.amber, borderRadius: 9, boxShadow: `0 0 20px ${C.amber}` }} />
          </div>
        </div>
      </Sequence>
      <Source text="NPCI press release, 2017" start={L.c1_05.at + 10} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S14 */
export const S14_ZeroMDR: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const zeroAt = L.c1_06.at + Math.round(L.c1_06.len * 0.82);
  const cyc = (frame % 54) / 54; // coin travel loop
  const isZero = frame >= zeroAt;
  const coinX = interpolate(cyc, [0, 1], [-560, 560], { ...clamp, easing: ease.cam });
  const slice = !isZero && cyc > 0.45 && cyc < 0.95;
  const sliceY = interpolate(cyc, [0.45, 0.95], [0, -260], clamp);
  const defIn = prog(frame, L.c1_07.at, 20, ease.cam);
  return (
    <AbsoluteFill>
      <Backdrop hue={isZero ? "teal" : "amber"} light={0.8} grid />
      <Dateline en="01 JAN 2020" hi="1 जनवरी 2020" start={L.c1_06.at} />
      {/* flow diagram (moves up when the definition card arrives) */}
      <AbsoluteFill style={{ transform: `translateY(${-defIn * 170}px) scale(${1 - defIn * 0.18})` }}>
        <div style={{ position: "absolute", left: 230, top: 400 }}>
          <Icon name="person" start={L.c1_06.at} size={220} color={C.ink} />
          <div style={{ fontFamily: F.hiBody, fontSize: 36, color: C.inkDim, textAlign: "center" }}>आप</div>
        </div>
        <div style={{ position: "absolute", right: 230, top: 400 }}>
          <Icon name="shop" start={L.c1_06.at + 6} size={220} color={C.ink} />
          <div style={{ fontFamily: F.hiBody, fontSize: 36, color: C.inkDim, textAlign: "center" }}>दुकानदार</div>
        </div>
        {/* the gate */}
        <div style={{ position: "absolute", left: 900, top: 380, width: 120, height: 280, borderLeft: `4px solid ${isZero ? C.teal : C.amber}`, borderRight: `4px solid ${isZero ? C.teal : C.amber}`, opacity: 0.8 }}>
          <div style={{ position: "absolute", top: -60, width: 300, left: -90, textAlign: "center", fontFamily: F.mono, fontSize: 28, letterSpacing: "0.2em", color: isZero ? C.teal : C.amber }}>
            MDR {isZero ? "0%" : "≤ 0.30%"}
          </div>
        </div>
        {/* bank + app take their cut */}
        <div style={{ position: "absolute", left: 1090, top: 190, display: "flex", gap: 10, opacity: isZero ? 0.25 : 0.9 }}>
          <Icon name="bank" start={L.c1_06.at + 10} size={90} color={C.inkDim} width={9} />
          <Icon name="phone" start={L.c1_06.at + 14} size={90} color={C.inkDim} width={9} />
        </div>
        {/* coin */}
        <div style={{ position: "absolute", left: 960 + coinX - 60, top: 470, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #fff3d6, #ffb347 45%, #b3560f)", boxShadow: "0 0 40px rgba(255,165,58,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.hiDisplay, fontSize: 54, color: "#3a1d05" }}>
          ₹100
        </div>
        {slice && (
          <div style={{ position: "absolute", left: 1050 + sliceY * 0.25, top: 520 + sliceY * 0.9, fontFamily: F.hiDisplay, fontSize: 54, color: C.amber, textShadow: `0 0 20px ${C.amber}` }}>−₹0.30</div>
        )}
        <div style={{ position: "absolute", right: 200, top: 700, fontFamily: F.mono, fontSize: 30, color: isZero ? C.green : C.inkDim, letterSpacing: "0.15em" }}>
          RECEIVES ₹{isZero ? "100.00" : "99.70"}
        </div>
      </AbsoluteFill>
      {isZero && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 0, transform: `translateY(${-defIn * 150}px) scale(${1 - defIn * 0.3})` }}>
          <Stamp text="MDR = 0" at={zeroAt} color={C.teal} size={150} sub="UPI · RUPAY DEBIT" blend="normal" />
        </AbsoluteFill>
      )}
      <Flash at={zeroAt} peak={0.3} color="46,230,214" />
      {/* definition */}
      <Sequence from={L.c1_07.at} layout="none">
        <div
          style={{
            position: "absolute",
            left: 260,
            right: 260,
            bottom: 120,
            padding: "34px 46px",
            borderRadius: 18,
            background: "rgba(8,12,20,0.86)",
            border: "1px solid rgba(242,239,232,0.14)",
            opacity: defIn,
            transform: `translateY(${(1 - defIn) * 60}px)`,
          }}
        >
          <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.3em", color: C.amber }}>MDR · MERCHANT DISCOUNT RATE</div>
          <Words text="Digital payment लेने पर *दुकानदार* जो छोटी सी fee देता है।|UPI पर पहले ये *0.30%* तक थी।" start={8} size={46} align="left" weight={500} />
        </div>
      </Sequence>
      <Source text="Finance Ministry (Dec 2019) · Forbes India" start={L.c1_06.at + 20} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S15 */
// Illustrative growth curve (shape only; endpoints are the verified numbers).
const curvePts = Array.from({ length: 121 }, (_, i) => {
  const t = i / 120;
  return [t, Math.pow(t, 3.2)] as const;
});

export const S15_Explosion: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const draw = prog(frame, L.c1_09.at, L.c1_09.len + 10, ease.in);
  const W0 = 1400, H0 = 560, X0 = 260, Y0 = 820;
  const n = Math.max(2, Math.floor(draw * curvePts.length));
  const d = curvePts.slice(0, n).map(([t, v], i) => `${i ? "L" : "M"}${X0 + t * W0},${Y0 - v * H0}`).join(" ");
  const head = curvePts[n - 1];
  const zoomOut = prog(frame, L.c1_10.at, 24, ease.cam);
  const ringIn = prog(frame, L.c1_11.at, 30, ease.cam);
  const burst = frame >= L.c1_09.end - 4;
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.9} grid />
      {burst && (
        <Stage env={false}>
          <CamRig pos={[0, 0, keys(frame, [[L.c1_09.end, 6], [seg.frames, 14]])]} />
          <RupeeField count={320} opacity={0.6} speed={3} />
        </Stage>
      )}
      {/* chart */}
      <AbsoluteFill style={{ opacity: 1 - ringIn, transform: `scale(${1 - zoomOut * 0.35}) translate(${-zoomOut * 520}px, ${-zoomOut * 120}px)` }}>
        <svg width={1920} height={1080}>
          <defs>
            <linearGradient id="g15" x1="0" x2="1">
              <stop offset="0" stopColor={C.teal} />
              <stop offset="1" stopColor={C.amber} />
            </linearGradient>
          </defs>
          <line x1={X0} y1={Y0} x2={X0 + W0} y2={Y0} stroke="rgba(242,239,232,0.3)" strokeWidth={2} />
          <path d={d} fill="none" stroke="url(#g15)" strokeWidth={7} strokeLinecap="round" style={{ filter: "drop-shadow(0 0 12px rgba(255,165,58,0.7))" }} />
          <circle cx={X0 + head[0] * W0} cy={Y0 - head[1] * H0} r={14} fill="#fff" style={{ filter: "drop-shadow(0 0 20px #ffa53a)" }} />
          <text x={X0} y={Y0 + 50} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={26} letterSpacing={4}>AUG 2016</text>
          <text x={X0 + W0} y={Y0 + 50} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={26} letterSpacing={4} textAnchor="end">SEP 2026</text>
          <text x={X0 + W0 - 10} y={Y0 + 82} fill="rgba(242,239,232,0.35)" fontFamily="IBM Plex Mono" fontSize={18} textAnchor="end">curve shape illustrative</text>
        </svg>
        <AbsoluteFill style={{ alignItems: "flex-start", padding: "130px 150px" }}>
          <Words text="और फिर... *UPI फट पड़ता है।*" start={L.c1_09.at} size={72} font={F.hiDisplay} weight={500} align="left" />
        </AbsoluteFill>
      </AbsoluteFill>
      {/* counter */}
      <Sequence from={L.c1_10.at} durationInFrames={L.c1_11.at - L.c1_10.at + 20} layout="none">
        <AbsoluteFill style={{ alignItems: "flex-end", justifyContent: "center", paddingRight: 150, opacity: 1 - ringIn }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.3em", color: C.inkDim }}>SEP 2026 · एक महीना</div>
            <Counter to={24070000000} start={4} dur={46} size={150} color={C.amber} />
            <div style={{ fontFamily: F.hiBody, fontSize: 44, color: C.ink, marginTop: -6 }}>= 24.07 अरब transactions</div>
            <div style={{ height: 1, background: C.inkFaint, margin: "26px 0" }} />
            <div style={{ fontFamily: F.hiDisplay, fontSize: 96, color: C.ink, lineHeight: 1, opacity: prog(frame - L.c1_10.at, Math.round(L.c1_10.len * 0.6), 14) }}>
              80 करोड़+ <span style={{ fontSize: 54, color: C.inkDim }}>/ दिन</span>
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Source text="NPCI data via Medianama, Entrackr (Oct 2026)" start={L.c1_10.at + 10} out={L.c1_11.at} />
      {/* half the world */}
      <Sequence from={L.c1_11.at} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: ringIn }}>
          <svg width={620} height={620} viewBox="-310 -310 620 620">
            <circle r={250} fill="none" stroke="rgba(242,239,232,0.12)" strokeWidth={46} />
            <circle
              r={250}
              fill="none"
              stroke={C.amber}
              strokeWidth={46}
              strokeDasharray={`${2 * Math.PI * 250 * 0.49 * prog(frame - L.c1_11.at, 8, 40, ease.cam)} ${2 * Math.PI * 250}`}
              transform="rotate(-90)"
              style={{ filter: "drop-shadow(0 0 18px rgba(255,165,58,0.8))" }}
            />
          </svg>
          <div style={{ position: "absolute", textAlign: "center" }}>
            <Counter to={49} start={8} dur={40} size={190} color={C.ink} suffix="%" />
            <div style={{ fontFamily: F.hiBody, fontSize: 40, color: C.inkDim }}>दुनिया के real-time payments</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 64, color: C.amber }}>भारत में</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Source text="ACI Worldwide, Prime Time for Real-Time 2024 (2023 data)" start={L.c1_11.at + 10} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S16 */
const TRIAD = [
  { hi: "फ़्री", en: "FREE" },
  { hi: "तेज़", en: "FAST" },
  { hi: "हर जगह", en: "EVERYWHERE" },
];

export const S16_PledgeEnd: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const L = relLines(seg);
  const base = L.c1_12.at + Math.round(L.c1_12.len * 0.35);
  const step = Math.round((L.c1_12.end - base) / 3);
  const doubt = prog(frame, L.c1_13.at + Math.round(L.c1_13.len * 0.35), 30, ease.cam);
  const push = keys(frame, [[0, 1], [seg.frames, 1.08]]);
  const Row: React.FC<{ reflect?: boolean }> = ({ reflect }) => (
    <div style={{ display: "flex", gap: 90, alignItems: "flex-end" }}>
      {TRIAD.map((w, i) => {
        const p = prog(frame, base + i * step, 8, ease.out);
        return (
          <div key={w.en} style={{ textAlign: "center", opacity: p, transform: `scale(${interpolate(p, [0, 1], [1.5, 1])})` }}>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 190, lineHeight: 0.9, color: reflect ? C.amber : C.ink }}>{reflect && doubt > 0.5 ? "?" : w.hi}</div>
            <div style={{ fontFamily: F.wide, fontSize: 24, letterSpacing: "0.4em", color: C.inkDim }}>{reflect && doubt > 0.5 ? "WHO PAYS" : w.en}</div>
          </div>
        );
      })}
    </div>
  );
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.7} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${push})` }}>
        <div style={{ marginTop: -160 }}>
          <Row />
        </div>
        {/* mirror floor: the reflection tells a different story */}
        <div
          style={{
            marginTop: 30,
            transform: "scaleY(-1)",
            opacity: 0.18 + doubt * 0.5,
            filter: `blur(${3 - doubt * 2}px)`,
            WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 75%)",
          }}
        >
          <Row reflect />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 100 }}>
        <Sequence from={L.c1_13.at} layout="none">
          <Words text="लेकिन जादू में, जो दिखता है...|वो *पूरा सच* नहीं होता।" start={2} size={54} />
        </Sequence>
      </AbsoluteFill>
      {TRIAD.map((_, i) => (
        <Flash key={i} at={base + i * step} peak={0.18} len={6} />
      ))}
      <LightLeak start={L.c1_13.at} dur={seg.frames - L.c1_13.at} color="255,80,60" strength={0.3} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

