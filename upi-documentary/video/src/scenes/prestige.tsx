import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { SceneProps, relLines, useTL } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog, rand } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Source, Stamp, Words } from "../components/Type";
import { Icon } from "../components/Icons";
import { Layer, ParallaxWorld } from "../components/Parallax";
import { PhotoPlate } from "../components/Media";
import { CamRig, Coin, Halo, RupeeField, Stage } from "../three/kit";

/* The bill, as a physical object. Line items are revealed as the story names them. */
const BillCard: React.FC<{ t: number; items: { label: string; sub: string; on: number; color: string }[]; stamp?: number }> = ({ t, items, stamp = 0 }) => {
  const tr = useT();
  return (
  <div
    style={{
      width: 640,
      padding: "40px 46px 46px",
      background: "linear-gradient(170deg, #f4eee2, #e2d8c3)",
      color: C.paperInk,
      boxShadow: `0 60px 160px rgba(0,0,0,0.85), 0 0 ${120 * t}px rgba(255,165,58,${0.25 * t})`,
      opacity: t,
      filter: `blur(${(1 - t) * 18}px)`,
      transform: `scale(${0.85 + t * 0.15})`,
      position: "relative",
    }}
  >
    <div style={{ fontFamily: F.hiDisplay, fontSize: 86, textAlign: "center", letterSpacing: "0.1em", lineHeight: 1 }}>{tr("BILL · बिल", "THE BILL")}</div>
    <div style={{ fontFamily: F.mono, fontSize: 18, textAlign: "center", letterSpacing: "0.3em", opacity: 0.6 }}>UPI · 2020 → 2026</div>
    <div style={{ borderTop: "2px dashed rgba(0,0,0,0.25)", margin: "22px 0 10px" }} />
    {items.map((it) => (
      <div key={it.label} style={{ padding: "16px 0", borderBottom: "1px dashed rgba(0,0,0,0.2)", opacity: it.on, transform: `translateX(${(1 - it.on) * 30}px)` }}>
        <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: "0.2em", color: it.color, fontWeight: 600 }}>PAID BY</div>
        <div style={{ fontFamily: F.hiBody, fontSize: 40, fontWeight: 700, lineHeight: 1.15 }}>{it.label}</div>
        <div style={{ fontFamily: F.hiBody, fontSize: 26, opacity: 0.7 }}>{it.sub}</div>
      </div>
    ))}
    {stamp > 0 && (
      <div style={{ position: "absolute", right: 30, bottom: 30 }}>
        <Stamp text="NOW DUE" at={0} color={C.red} size={56} rotate={-10} sub={tr("MERCHANT · दुकानदार", "MERCHANT")} blend="multiply" />
      </div>
    )}
  </div>
);
};

/* ---------------------------------------------------------------- S40 */
export const S40_Return: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const cardIn = prog(frame, L.c4_01.at, 30, ease.cam);
  const cardOut = prog(frame, L.c4_02.at - 6, 20, ease.in);
  const billT = prog(frame, L.c4_02.at + Math.round(L.c4_02.len * L.c4_02.fr(0.2)), 40, ease.soft);
  const item1 = prog(frame, L.c4_03.at + 10, 18);
  const item2 = prog(frame, L.c4_03.at + Math.round(L.c4_03.len * L.c4_03.fr(0.62)), 18);
  const toShop = prog(frame, L.c4_04.at, 34, ease.cam);
  const stampOn = frame >= L.c4_04.at + Math.round(L.c4_04.len * L.c4_04.fr(0.6));
  const cam = {
    x: drift(frame, 2, 14) + toShop * 120,
    y: toShop * 60,
    z: keys(frame, [[L.c4_02.at, -80], [L.c4_04.at, 120], [seg.frames, 60]]),
    ry: keys(frame, [[0, -4], [seg.frames, 5]]),
  };
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.6 + billT * 0.4} />
      {/* spotlight cone */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 22% 70% at 50% 0%, rgba(255,240,210,${0.12 + billT * 0.1}), rgba(0,0,0,0) 70%)` }} />
      {/* c4_01: the third card returns (callback to the three parts) */}
      <Sequence durationInFrames={L.c4_02.at + 20} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: cardIn * (1 - cardOut), transform: `scale(${0.9 + cardIn * 0.1 + cardOut * 0.3})` }}>
          <div style={{ width: 460, height: 660, borderRadius: 18, border: `1.5px solid ${C.amber}`, background: "linear-gradient(160deg, rgba(20,26,40,0.92), rgba(6,8,14,0.95))", boxShadow: "0 0 120px rgba(255,165,58,0.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
            <div style={{ fontFamily: F.serif, fontSize: 80, color: C.amber, lineHeight: 1 }}>III</div>
            <div style={{ fontSize: 140, color: C.amber, lineHeight: 1, textShadow: "0 0 50px rgba(255,165,58,0.8)" }}>◉</div>
            <div style={{ fontFamily: F.wide, fontWeight: 300, fontSize: 36, letterSpacing: "0.32em", paddingLeft: "0.32em", color: C.ink }}>THE PRESTIGE</div>
            <div style={{ fontFamily: F.hiSerif, fontSize: 56, color: C.inkDim }}>{t("वापसी", "The return")}</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* converging rupees as the bill re-forms */}
      {frame >= L.c4_02.at - 10 && frame < L.c4_03.at + 30 && (
        <Stage env={false}>
          <CamRig pos={[0, 0, keys(frame, [[L.c4_02.at, 6], [L.c4_03.at, 14]])]} />
          <RupeeField count={240} opacity={0.6 * (1 - billT * 0.7)} speed={-3} spread={[16, 10, 10]} />
        </Stage>
      )}
      {/* the bill + the shop counter in 2.5D */}
      <Sequence from={L.c4_02.at} layout="none">
        <ParallaxWorld cam={cam}>
          <Layer z={-400} opacity={toShop}>
            <PhotoPlate
              name="kirana_shop"
              dur={seg.frames}
              fallback={
                <AbsoluteFill style={{ background: "linear-gradient(#1a140c, #0b0805)" }}>
                  {/* stylised shelves */}
                  {Array.from({ length: 5 }).map((_, r) => (
                    <div key={r} style={{ position: "absolute", left: 80, right: 80, top: 120 + r * 150, height: 110, display: "flex", gap: 14, alignItems: "flex-end", borderBottom: "6px solid #3a2a18" }}>
                      {Array.from({ length: 22 }).map((_, i) => (
                        <div key={i} style={{ flex: 1, height: 40 + rand(r * 31 + i) * 60, background: `hsl(${(rand(i * 7 + r) * 360) | 0}, 45%, ${18 + rand(i + r * 3) * 14}%)`, borderRadius: 4 }} />
                      ))}
                    </div>
                  ))}
                </AbsoluteFill>
              }
            />
          </Layer>
          <Layer z={-120} y={420} opacity={toShop}>
            <AbsoluteFill style={{ justifyContent: "flex-end" }}>
              <div style={{ height: 380, background: "linear-gradient(#5a3b1f, #2a1a0c)", borderTop: "8px solid #7a5530", boxShadow: "0 -30px 80px rgba(0,0,0,0.6)" }} />
            </AbsoluteFill>
          </Layer>
          <Layer z={-60} x={-560} y={60} opacity={toShop}>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 230, height: 320, background: "#f2efe8", borderRadius: 14, padding: 22, boxShadow: "0 30px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontFamily: F.mono, fontSize: 16, letterSpacing: "0.2em", color: C.paperInk }}>SCAN & PAY</div>
                <div style={{ width: 170, height: 170, marginTop: 14, background: "repeating-conic-gradient(#111 0 25%, #f2efe8 0 50%) 0 0/34px 34px", borderRadius: 4 }} />
                <div style={{ fontFamily: F.hiDisplay, fontSize: 40, color: C.paperInk, marginTop: 10 }}>UPI</div>
              </div>
            </AbsoluteFill>
          </Layer>
          <Layer z={40} x={toShop * 120} y={toShop * 40} rotateX={toShop * 8}>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
              <BillCard
                t={billT}
                stamp={stampOn ? 1 : 0}
                items={[
                  { label: t("Taxpayers — सरकारी incentive", "Taxpayers — government incentives"), sub: t("₹1,389 → ₹3,631 करोड़ / साल (FY22–24)", "₹1,389 → ₹3,631 crore a year (FY22–24)"), on: item1, color: C.amberDeep },
                  { label: t("बैंक और payment companies", "Banks and payment companies"), sub: t("बाक़ी ख़र्च — industry के मुताबिक़", "the rest of the cost — per the industry"), on: item2, color: C.amberDeep },
                ]}
              />
            </AbsoluteFill>
          </Layer>
        </ParallaxWorld>
      </Sequence>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
        <Sequence durationInFrames={L.c4_02.at} layout="none">
          <Words text={t("तीसरा हिस्सा — *The Prestige।*|जब ग़ायब हुई चीज़... वापस आती है।", "Part three — *the Prestige.*|When the vanished thing... comes back.")} start={L.c4_01.at + 10} size={54} />
        </Sequence>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(rgba(4,6,11,0.9) 0%, rgba(4,6,11,0.55) 16%, rgba(4,6,11,0) 30%)", opacity: toShop }} />
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 100 }}>
        <Sequence from={L.c4_02.at} durationInFrames={L.c4_03.at - L.c4_02.at} layout="none">
          <Words text={t("वो बिल... *कभी ग़ायब हुआ ही नहीं।*", "The bill... *never really disappeared.*")} start={4} size={58} />
        </Sequence>
        <Sequence from={L.c4_04.at} layout="none">
          <Words text={t("अब वो बिल लौट आया है — *दुकानदार के counter पर।*", "Now the bill is back — *on the shopkeeper's counter.*")} start={4} size={54} />
        </Sequence>
      </AbsoluteFill>
      <Flash at={L.c4_02.at + Math.round(L.c4_02.len * L.c4_02.fr(0.2)) + 20} peak={0.3} color="255,200,140" />
      <Source text="PIB (incentives) · Payments Council of India (costs)" start={L.c4_03.at + 10} out={L.c4_04.at} />
      <Dust count={50} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S41 */
const WHO = [
  { role: "TAXPAYER", hi: "Taxpayer के रूप में", ans: "आप", en: "As a taxpayer", ansEn: "YOU", color: C.amber },
  { role: "CUSTOMER", hi: "Customer के रूप में", ans: "शायद आप", en: "As a customer", ansEn: "MAYBE YOU", color: C.amber },
  { role: "IF THE SYSTEM WEAKENS", hi: "System कमज़ोर पड़ा, तो", ans: "नुक़सान — आपका", en: "If the system weakens", ansEn: "YOUR LOSS", color: C.red },
];

export const S41_WhoPays: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const econAt = L.c4_05.at + Math.round(L.c4_05.len * L.c4_05.fr(0.45));
  const split = prog(frame, L.c4_05.at, 20, ease.cam);
  const triIn = prog(frame, L.c4_06.at, 20, ease.cam);
  const q = L.c4_06;
  const beats = [0.3, 0.55, 0.8].map((k) => q.at + Math.round(q.len * q.fr(k)));
  const mirror = prog(frame, q.end + 4, 30, ease.cam);
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.7} />
      {/* c4_05: law vs economics */}
      <Sequence durationInFrames={L.c4_06.at + 16} layout="none">
        <AbsoluteFill style={{ flexDirection: "row", opacity: split * (1 - triIn) }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRight: `1px solid ${C.inkFaint}` }}>
            <Icon name="gavel" start={L.c4_05.at} size={190} color={C.teal} />
            <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.35em", color: C.teal }}>{t("THE LAW · क़ानून", "THE LAW")}</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.ink, lineHeight: 1.05, marginTop: 10 }}>Customer: ₹0</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.inkDim }}>{t("charge आप पर नहीं डाला जा सकता", "the charge can't be passed on to you")}</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: prog(frame, econAt, 16) }}>
            <svg width={230} height={190} viewBox="0 0 230 190" style={{ overflow: "visible" }}>
              <path d="M20 60 L120 20 L210 110 L110 170 Z" fill="none" stroke={C.amber} strokeWidth={7} strokeLinejoin="round" />
              <circle cx={112} cy={62} r={14} fill="none" stroke={C.amber} strokeWidth={6} />
              <text x={128} y={130} fill={C.amber} fontFamily="Teko" fontSize={72} textAnchor="middle">₹?</text>
            </svg>
            <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.35em", color: C.amber, marginTop: 10 }}>ECONOMICS</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 80, color: C.ink, lineHeight: 1.05, marginTop: 10, textAlign: "center" }}>{t("हर ख़र्च → क़ीमत में?", "Every cost → in prices?")}</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.inkDim }}>{t("आख़िर में कहीं न कहीं दिख ही जाता है", "it shows up somewhere, eventually")}</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* c4_06: who pays — the reveal */}
      <Sequence from={L.c4_06.at} layout="none">
        <AbsoluteFill style={{ opacity: triIn * (1 - mirror) }}>
          <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 120 }}>
            <Words text={t("तो *free UPI* का बिल कौन भरता है?", "So who pays for *free UPI?*")} start={2} size={60} />
          </AbsoluteFill>
          <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 50, paddingTop: 80 }}>
            {WHO.map((w, i) => {
              const on = prog(frame, beats[i], 12, ease.out);
              return (
                <div key={w.role} style={{ width: 470, height: 520, borderRadius: 16, border: `1px solid ${on > 0.5 ? w.color : C.inkFaint}`, background: "rgba(8,12,20,0.8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${70 * on}px ${w.color}44`, opacity: 0.35 + on * 0.65 }}>
                  <Icon name="person" start={beats[i] - 20} size={170} color={on > 0.5 ? w.color : C.inkDim} width={8} />
                  <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.25em", color: C.inkDim, marginTop: 10 }}>{w.role}</div>
                  <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.ink, marginTop: 6 }}>{t(w.hi, w.en)}</div>
                  <div style={{ fontFamily: F.hiDisplay, fontSize: 96, color: w.color, lineHeight: 1.05, opacity: on, transform: `scale(${interpolate(on, [0, 1], [1.4, 1])})` }}>{t(w.ans, w.ansEn)}</div>
                </div>
              );
            })}
          </AbsoluteFill>
        </AbsoluteFill>
        {/* the mirror: it was always you */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: mirror }}>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 420, color: C.amber, lineHeight: 0.9, textShadow: "0 0 120px rgba(255,165,58,0.6)", transform: `scale(${0.9 + mirror * 0.1})` }}>{t("आप", "YOU")}</div>
          <div style={{ fontFamily: F.wide, fontWeight: 300, fontSize: 34, letterSpacing: "0.8em", paddingLeft: "0.8em", color: C.inkDim }}>{t("YOU", "IT WAS ALWAYS YOU")}</div>
        </AbsoluteFill>
      </Sequence>
      {beats.map((b, i) => (
        <Flash key={i} at={b} peak={0.15} len={7} />
      ))}
      <LightLeak start={q.end - 10} dur={80} strength={0.45} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S42 */
const Plate: React.FC<{ x: number; y: number; title: string; sub: string; icons: ("server" | "shield" | "shop")[]; color: string; t: number }> = ({ x, y, title, sub, icons, color, t }) => (
  <div style={{ position: "absolute", left: x - 260, top: y, width: 520, textAlign: "center", opacity: t }}>
    <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
      {icons.map((ic, i) => (
        <Icon key={i} name={ic} start={0} size={110} color={color} width={9} dur={1} />
      ))}
    </div>
    <div style={{ fontFamily: F.hiDisplay, fontSize: 58, color: C.ink, lineHeight: 1.05 }}>{title}</div>
    <div style={{ fontFamily: F.hiBody, fontSize: 30, color: C.inkDim }}>{sub}</div>
  </div>
);

export const S42_Question: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const strikeAt = L.c4_07.at + Math.round(L.c4_07.len * L.c4_07.fr(0.3));
  const strike = prog(frame, strikeAt, 14, ease.out);
  const realQ = prog(frame, L.c4_07.at + Math.round(L.c4_07.len * L.c4_07.fr(0.5)), 16);
  const scaleIn = prog(frame, L.c4_08.at, 24, ease.cam);
  const leftOn = prog(frame, L.c4_08.at + 10, 16);
  const rightOn = prog(frame, L.c4_08.at + Math.round(L.c4_08.len * L.c4_08.fr(0.45)), 16);
  // the beam never settles
  const tilt = (Math.sin((frame - L.c4_08.at) * 0.045) * 9 + Math.sin((frame - L.c4_08.at) * 0.019) * 4) * scaleIn;
  const rad = (tilt * Math.PI) / 180;
  const arm = 560;
  const ly = 470 - Math.sin(rad) * arm, ry = 470 + Math.sin(rad) * arm;
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.75} />
      {/* c4_07 */}
      <Sequence durationInFrames={L.c4_08.at + 10} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - scaleIn }}>
          <div style={{ position: "relative", fontFamily: F.hiDisplay, fontSize: 96, color: C.inkDim, opacity: prog(frame, L.c4_07.at, 14) }}>
            {t("UPI फ़्री रहे या नहीं?", "Should UPI stay free?")}
            <div style={{ position: "absolute", left: 0, top: "52%", height: 8, width: `${strike * 100}%`, background: C.red, boxShadow: `0 0 20px ${C.red}` }} />
          </div>
          <div style={{ marginTop: 50, opacity: realQ, transform: `translateY(${(1 - realQ) * 30}px)`, textAlign: "center" }}>
            <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.35em", color: C.amber }}>{t("THE REAL QUESTION · असली सवाल", "THE REAL QUESTION")}</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.ink, lineHeight: 1.05 }}>{t("क़ीमत कौन चुकाए — और कैसे?", "Who should pay — and how?")}</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* c4_08: the scale */}
      <Sequence from={L.c4_08.at} layout="none">
        <AbsoluteFill style={{ opacity: scaleIn }}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            <line x1={960} y1={470} x2={960} y2={900} stroke={C.ink} strokeWidth={6} />
            <path d="M860 900 L1060 900" stroke={C.ink} strokeWidth={8} strokeLinecap="round" />
            <line x1={960 - Math.cos(rad) * arm} y1={ly} x2={960 + Math.cos(rad) * arm} y2={ry} stroke={C.ink} strokeWidth={6} strokeLinecap="round" />
            <circle cx={960} cy={470} r={16} fill={C.amber} />
            {[[960 - Math.cos(rad) * arm, ly], [960 + Math.cos(rad) * arm, ry]].map(([x, y], i) => (
              <g key={i}>
                <line x1={x} y1={y} x2={x - 120} y2={y + 150} stroke={C.inkDim} strokeWidth={2} />
                <line x1={x} y1={y} x2={x + 120} y2={y + 150} stroke={C.inkDim} strokeWidth={2} />
                <path d={`M${x - 150} ${y + 150} Q${x} ${y + 200} ${x + 150} ${y + 150}`} stroke={C.ink} strokeWidth={5} fill="none" />
              </g>
            ))}
          </svg>
          <Plate x={960 - Math.cos(rad) * arm} y={ly + 210} title={t("System को पैसा चाहिए", "The system needs money")} sub="security · servers · uptime" icons={["server", "shield"]} color={C.teal} t={leftOn} />
          <Plate x={960 + Math.cos(rad) * arm} y={ry + 210} title={t("करोड़ों छोटे दुकानदार", "Millions of small shops")} sub={t("और cash की वापसी का ख़तरा", "and the risk of a return to cash")} icons={["shop"]} color={C.amber} t={rightOn} />
        </AbsoluteFill>
      </Sequence>
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S43 */
export const S43_Coin: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  // spin slows very slightly and the wobble grows — but it never falls on screen
  const angle = frame * 0.42 - frame * frame * 0.00012;
  const wobble = 0.06 + prog(frame, 0, seg.frames, ease.in) * 0.16;
  const camZ = keys(frame, [[0, 9], [seg.frames, 5.6]]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 60% 50% at 50% 45%, #141a26 0%, #04060b 75%)" }} />
      <Stage fov={32}>
        <CamRig pos={[drift(frame, 3, 0.25), 1.4, camZ]} target={[0, 1.0, 0]} fov={32} />
        <ambientLight intensity={0.15} />
        <spotLight position={[2, 7, 4]} angle={0.4} penumbra={0.8} intensity={320} color="#fff1dc" />
        <pointLight position={[-1.5, 2.6, -4]} intensity={14} color={C.teal} />
        <pointLight position={[3, 1.5, 3]} intensity={18} color="#ffc890" />
        {/* glossy table */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[40, 40]} />
          <meshPhongMaterial color="#07090e" specular="#3a3f4a" shininess={60} />
        </mesh>
        {/* spinning coin standing on its edge */}
        <group position={[0, 1.0, 0]} rotation={[0, 0, Math.sin(frame * 0.35) * wobble]}>
          <Coin angle={angle} tilt={0} scale={1} />
        </group>
        <Halo position={[0, 0.05, 0]} size={2.6} color="#ffffff" opacity={0.12} />
      </Stage>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
        <Sequence durationInFrames={L.c4_10.at} layout="none">
          <Words text={t("फ़िलहाल — नई तारीख़ का इंतज़ार।|Supreme Court में मामला *अभी बाक़ी* है।", "For now — waiting for a new date.|The Supreme Court case is *still pending.*")} start={L.c4_09.at} size={52} />
        </Sequence>
        <Sequence from={L.c4_10.at} layout="none">
          <Words text={t("सिक्का... *अभी घूम रहा है।*", "The coin... *is still spinning.*")} start={2} size={72} font={F.hiDisplay} weight={500} stagger={6} />
        </Sequence>
      </AbsoluteFill>
      <Letterbox amount={1} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S50 */
const KEY_SOURCES = [
  "NPCI — monthly UPI statistics (Sep 2026)",
  "Ministry of Finance — notification, 14 Sep 2026",
  "NPCI — operational circular, 15 Sep 2026",
  "PIB — Cabinet release on UPI incentive, 19 Mar 2025",
  "RBI Governor Sanjay Malhotra — remarks, 25 Jul 2025 (IANS)",
  "Finance Ministry — statements, 21 Aug 2022 & 11 Jun 2025",
  "Payments Council of India — letter, Mar 2025 (Forbes)",
  "LocalCircles — merchant & consumer surveys, Sep 2026",
  "Supreme Court hearing, 28 Sep 2026 (PTI / ThePrint)",
  "NPCI deferral, 13 Oct 2026 (PTI / ThePrint, The Tribune)",
  "ACI Worldwide — Prime Time for Real-Time 2024",
];

export const S50_Outro: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const TL = useTL();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const endAt = L.c5_01.end + 10;
  const end = prog(frame, endAt, 24, ease.cam);
  const vote = (k: number) => prog(frame, L.c5_01.at + Math.round(L.c5_01.len * k), 12, ease.out);
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.6} />
      {/* CTA */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - end, transform: `scale(${1 - end * 0.1})` }}>
        <Words text={t("आपको क्या लगता है?", "What do you think?")} start={L.c5_01.at} size={70} color={C.inkDim} weight={500} />
        <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.ink, lineHeight: 1.05, marginTop: 10, opacity: vote(0.15) }}>{t("₹2,000+ पर ये fee —", "This fee on ₹2,000+ payments —")}</div>
        <div style={{ display: "flex", gap: 60, marginTop: 40 }}>
          <div style={{ padding: "14px 60px", border: `3px solid ${C.green}`, borderRadius: 60, fontFamily: F.hiDisplay, fontSize: 90, color: C.green, opacity: vote(0.28), transform: `scale(${interpolate(vote(0.28), [0, 1], [1.3, 1])})` }}>{t("सही ✓", "FAIR ✓")}</div>
          <div style={{ padding: "14px 60px", border: `3px solid ${C.red}`, borderRadius: 60, fontFamily: F.hiDisplay, fontSize: 90, color: C.red, opacity: vote(0.36), transform: `scale(${interpolate(vote(0.36), [0, 1], [1.3, 1])})` }}>{t("ग़लत ✕", "UNFAIR ✕")}</div>
        </div>
        <div style={{ fontFamily: F.hiBody, fontSize: 40, color: C.ink, marginTop: 40, opacity: vote(0.55) }}>{t("Comments में बताइए · Sources description में", "Tell us in the comments · Sources in the description")}</div>
      </AbsoluteFill>
      {/* end screen: room for YouTube's end-screen elements on the right, sources on the left */}
      <AbsoluteFill style={{ opacity: end }}>
        <div style={{ position: "absolute", left: 140, top: 150, width: 820 }}>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 64, color: C.ink, lineHeight: 1 }}>{t(TL.title_hi, "WHO REALLY PAYS FOR YOUR 'FREE' UPI?")}</div>
          <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", color: C.amber, margin: "24px 0 18px" }}>KEY SOURCES</div>
          {KEY_SOURCES.map((s, i) => (
            <div key={s} style={{ fontFamily: F.mono, fontSize: 21, color: C.inkDim, lineHeight: 1.75, opacity: prog(frame, endAt + 10 + i * 3, 10) }}>
              · {s}
            </div>
          ))}
          <div style={{ fontFamily: F.mono, fontSize: 18, color: C.inkFaint, marginTop: 20 }}>Full list with links in the description · Facts as of {TL.facts_as_of}</div>
        </div>
        {/* faint guides where the end-screen video + subscribe elements go */}
        <div style={{ position: "absolute", right: 150, top: 220, width: 640, height: 360, border: "1px dashed rgba(242,239,232,0.12)", borderRadius: 12 }} />
        <div style={{ position: "absolute", right: 370, top: 640, width: 200, height: 200, border: "1px dashed rgba(242,239,232,0.12)", borderRadius: "50%" }} />
      </AbsoluteFill>
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

