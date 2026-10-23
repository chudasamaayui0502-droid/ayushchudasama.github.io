import React, { useMemo } from "react";
import * as THREE from "three";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { Line as DreiLine } from "@react-three/drei";
import { SceneProps, relLines } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog, rand } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Counter, Source, Words } from "../components/Type";
import { Icon, IconName } from "../components/Icons";
import { Layer, ParallaxWorld } from "../components/Parallax";
import { CamRig, GlowNode, Halo, QRBlocks, QR_TEXT, RupeeField, Stage, projectToScreen, qrMatrix } from "../three/kit";

/* ---------------------------------------------------------------- S20 */
export const S20_Vanish: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const goAt = L.c2_01.at + Math.round(L.c2_01.len * L.c2_01.fr(0.7));
  const scatter = prog(frame, goAt, 46, ease.in);
  const camZ = keys(frame, [[0, 11], [goAt, 9.5], [L.c2_02.at, 7]]);
  const billP = prog(frame, L.c2_02.at + Math.round(L.c2_02.len * L.c2_02.fr(0.55)), 10, ease.out);
  const billGone = prog(frame, L.c2_02.end + 6, 26, ease.in);
  return (
    <AbsoluteFill>
      <Backdrop hue="teal" light={0.6 - scatter * 0.4} />
      <Stage>
        <CamRig pos={[drift(frame, 5, 0.3), 0.4, camZ]} target={[0, 0, 0.5]} />
        <ambientLight intensity={0.15} />
        <spotLight position={[0, 6, 8]} angle={0.5} penumbra={0.9} intensity={240} color="#fff2dc" />
        <pointLight position={[-5, -3, 2]} intensity={30} color={C.teal} />
        <Halo position={[0, 0, -0.5]} size={10} color={C.teal} opacity={0.5 * (1 - scatter)} />
        <QRBlocks cells={cells} rise={1} scatter={scatter} size={4.4} color="#f2efe8" emissive={0.3} />
      </Stage>
      <AbsoluteFill style={{ background: "linear-gradient(rgba(4,6,11,0) 50%, rgba(4,6,11,0.9) 82%)", opacity: 1 - scatter }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
        <Sequence durationInFrames={L.c2_02.at} layout="none">
          <Words text={t("दूसरा हिस्सा — *The Turn।*|जादूगर उस चीज़ को... *ग़ायब* कर देता है।", "Part two — *the Turn.*|The magician makes it... *disappear.*")} start={L.c2_01.at} size={56} />
        </Sequence>
      </AbsoluteFill>
      <Sequence from={L.c2_02.at} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 200 }}>
          <Words text={t("UPI में जो ग़ायब हुआ, वो था —", "In UPI, what disappeared was —")} start={2} size={50} color={C.inkDim} />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              fontFamily: F.hiDisplay,
              fontSize: 330,
              color: C.amber,
              opacity: billP * (1 - billGone),
              transform: `scale(${1 + billGone * 0.25})`,
              filter: `blur(${billGone * 30}px)`,
              letterSpacing: `${billGone * 0.4}em`,
              textShadow: `0 0 80px ${C.amber}88`,
              marginTop: 80,
            }}
          >
            {t("बिल", "THE BILL")}
          </div>
        </AbsoluteFill>
        {billGone > 0 && (
          <Stage env={false}>
            <CamRig pos={[0, 0, 8]} />
            <RupeeField count={200} opacity={0.7 * (1 - billGone * 0.6)} speed={4} spread={[10, 8, 6]} />
          </Stage>
        )}
      </Sequence>
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S21 */
const MACHINE: { label: string; hi: string; en: string; icon: IconName; p: [number, number, number]; color: string }[] = [
  { label: "YOUR APP", hi: "आपका app", en: "Scan & pay", icon: "phone", p: [-8, -0.6, 0], color: C.teal },
  { label: "YOUR BANK", hi: "आपका बैंक", en: "Debits you", icon: "bank", p: [-4, 0.9, -2], color: C.teal },
  { label: "NPCI SWITCH", hi: "NPCI", en: "Routes it", icon: "server", p: [0, -0.2, -3.2], color: C.amber },
  { label: "SHOP'S BANK", hi: "दुकानदार का बैंक", en: "Credits the shop", icon: "bank", p: [4, 0.9, -2], color: C.teal },
  { label: "SHOP", hi: "दुकान", en: "Gets paid", icon: "shop", p: [8, -0.6, 0], color: C.teal },
];

const Packet: React.FC<{ t: number; curve: THREE.CatmullRomCurve3; color: string }> = ({ t, curve, color }) => {
  const p = curve.getPointAt(Math.max(0, Math.min(1, t)));
  return (
    <group position={p}>
      <mesh>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <Halo size={2.4} color={color} opacity={0.9} />
    </group>
  );
};

export const S21_Machine: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(MACHINE.map((m) => new THREE.Vector3(...m.p))), []);
  const pts = useMemo(() => curve.getPoints(200).map((v) => [v.x, v.y, v.z] as [number, number, number]), [curve]);
  const reveal = prog(frame, L.c2_03.at + 20, L.c2_03.len * L.c2_03.fr(0.75), ease.soft); // path draws as the nodes are named
  const askAt = L.c2_05.at + Math.round(L.c2_05.len * L.c2_05.fr(0.45));
  const stalled = frame >= askAt;
  const loop = ((frame - L.c2_03.at) % 75) / 75;
  const camPos: [number, number, number] = [keys(frame, [[0, -6], [seg.frames, 5]]) , 3.2 + drift(frame, 1, 0.2), keys(frame, [[0, 13], [L.c2_04.at, 15], [seg.frames, 12]])];
  const target: [number, number, number] = [keys(frame, [[0, -3], [seg.frames, 2]]), 0, -1.5];
  const fov = 38;
  return (
    <AbsoluteFill>
      <Backdrop hue={stalled ? "amber" : "teal"} light={0.7} grid />
      <Stage fov={fov} fog={["#04060b", 12, 36]}>
        <CamRig pos={camPos} target={target} fov={fov} />
        <ambientLight intensity={0.3} />
        <DreiLine points={pts.slice(0, Math.max(2, Math.floor(reveal * pts.length)))} color={stalled ? C.amber : C.teal} lineWidth={3} transparent opacity={0.8} />
        {MACHINE.map((m, i) => (
          <GlowNode key={m.label} position={m.p} size={i === 2 ? 0.55 : 0.4} color={stalled ? C.amber : m.color} on={prog(frame, L.c2_03.at + 20 + i * (L.c2_03.len * L.c2_03.fr(0.15)), 12)} />
        ))}
        {reveal > 0.98 && !stalled && <Packet t={loop} curve={curve} color={C.teal} />}
        {stalled && <Packet t={0.5} curve={curve} color={C.amber} />}
      </Stage>
      {/* labels projected from 3D */}
      {MACHINE.map((m, i) => {
        const s = projectToScreen([m.p[0], m.p[1] - 1.1, m.p[2]], camPos, target, fov);
        const on = prog(frame, L.c2_03.at + 20 + i * (L.c2_03.len * L.c2_03.fr(0.15)), 12);
        return (
          <div key={m.label} style={{ position: "absolute", left: s.x - 150, top: s.y, width: 300, textAlign: "center", opacity: on }}>
            <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.25em", color: stalled ? C.amber : C.teal }}>{m.label}</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.ink, fontWeight: 600 }}>{t(m.hi, m.en)}</div>
          </div>
        );
      })}
      {/* c2_04: the hidden work */}
      <Sequence from={L.c2_04.at} durationInFrames={L.c2_05.at - L.c2_04.at + 10} layout="none">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
          <div style={{ display: "flex", gap: 80 }}>
            {(
              [
                ["server", "SERVERS"],
                ["shield", "SECURITY"],
                ["search", "FRAUD CHECKS"],
                ["headset", "SUPPORT"],
              ] as [IconName, string][]
            ).map(([ic, lb], i) => (
              <div key={lb} style={{ textAlign: "center", opacity: prog(frame - L.c2_04.at, i * 14, 10) }}>
                <Icon name={ic} start={i * 14} size={110} color={C.ink} width={8} dur={16} />
                <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.22em", color: C.inkDim, marginTop: 8 }}>{lb}</div>
              </div>
            ))}
            <div style={{ textAlign: "center", opacity: prog(frame - L.c2_04.at, Math.round(L.c2_04.len * L.c2_04.fr(0.6)), 10) }}>
              <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.amber, lineHeight: 1.05 }}>24×7</div>
              <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.22em", color: C.inkDim, marginTop: 8 }}>{t("चौबीसों घंटे", "AROUND THE CLOCK")}</div>
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* c2_05: where did the cost go? */}
      <Sequence from={L.c2_05.at} layout="none">
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 120 }}>
          <Words text={t("ये सब *मुफ़्त नहीं* है।", "None of this is *free.*")} start={2} size={58} />
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 140 }}>
          <Words text={t("तो ये ख़र्च... *गया कहाँ?*", "So where did *the cost go?*")} start={askAt - L.c2_05.at} size={86} font={F.hiDisplay} weight={500} />
        </AbsoluteFill>
      </Sequence>
      <Flash at={askAt} peak={0.22} color="255,165,58" />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S22 */
/** A CSS-3D box bar (front, side, top faces) — reads as a real 3D chart under the parallax camera. */
const Bar3D: React.FC<{ h: number; w?: number; d?: number; color: string; x: number; label: string; value: string; on: number }> = ({
  h,
  w = 190,
  d = 120,
  color,
  x,
  label,
  value,
  on,
}) => {
  const t = useT();
  const hh = h * on;
  const face: React.CSSProperties = { position: "absolute", left: 0, bottom: 0, transformOrigin: "50% 100%" };
  return (
    <div style={{ position: "absolute", left: 960 + x - w / 2, top: 850, width: w, height: 0, transformStyle: "preserve-3d" }}>
      <div style={{ ...face, width: w, height: hh, background: `linear-gradient(${color}, ${color}88)`, transform: `translateZ(${d / 2}px)`, boxShadow: `0 0 60px ${color}55` }} />
      <div style={{ ...face, width: d, height: hh, left: w - d / 2, background: `linear-gradient(${color}aa, ${color}44)`, transform: `rotateY(90deg)`, transformOrigin: "50% 100%" }} />
      <div style={{ position: "absolute", left: 0, top: -hh - d / 2, width: w, height: d, background: `${color}`, filter: "brightness(1.35)", transform: `translateY(${d / 2}px) rotateX(90deg)`, transformOrigin: "50% 50%" }} />
      <div style={{ position: "absolute", left: -60, width: w + 120, top: -hh - 150, textAlign: "center", opacity: on, transform: `translateZ(${d / 2}px)` }}>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 80, color: C.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: F.hiBody, fontSize: 28, color: C.inkDim }}>{t("करोड़", "crore")}</div>
      </div>
      <div style={{ position: "absolute", left: -40, width: w + 80, top: 26, textAlign: "center", fontFamily: F.mono, fontSize: 26, letterSpacing: "0.15em", color: C.inkDim, transform: `translateZ(${d / 2}px)` }}>{label}</div>
    </div>
  );
};

export const S22_Subsidy: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const chartIn = prog(frame, L.c2_07.at, 24, ease.cam);
  const v = [1389, 2210, 3631];
  const bars = v.map((_, i) => prog(frame, L.c2_07.at + Math.round(L.c2_07.len * (0.22 + i * 0.25)), 34, ease.out));
  const cam = {
    x: keys(frame, [[L.c2_07.at, -200], [seg.frames, 180]]),
    y: 20 + drift(frame, 2, 6),
    z: keys(frame, [[L.c2_07.at, -220], [seg.frames, 40]]),
    rx: -12,
    ry: keys(frame, [[L.c2_07.at, 14], [seg.frames, -10]]),
  };
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.8} />
      {/* c2_06: taxpayer → government */}
      <Sequence durationInFrames={L.c2_07.at + 20} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - chartIn }}>
          <div style={{ display: "flex", alignItems: "center", gap: 70 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2].map((i) => (
                  <Icon key={i} name="person" start={L.c2_06.at + Math.round(L.c2_06.len * L.c2_06.fr(0.5)) + i * 4} size={110} color={C.ink} width={9} />
                ))}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.25em", color: C.inkDim }}>{t("TAXPAYERS · करदाता", "TAXPAYERS")}</div>
            </div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 90, color: C.amber, opacity: prog(frame, L.c2_06.at + Math.round(L.c2_06.len * L.c2_06.fr(0.6)), 10) }}>→</div>
            <div style={{ textAlign: "center" }}>
              <Icon name="govt" start={L.c2_06.at + 4} size={240} color={C.amber} />
              <div style={{ fontFamily: F.hiDisplay, fontSize: 64, color: C.ink }}>{t("सरकार", "GOVERNMENT")}</div>
            </div>
          </div>
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150, opacity: 1 - chartIn }}>
          <Words text={t("पहला जवाब — *सरकार।* यानी, taxpayer का पैसा।", "Answer one — *the government.* In other words, taxpayers.")} start={L.c2_06.at} size={54} />
        </AbsoluteFill>
      </Sequence>
      {/* c2_07: the incentive bars */}
      <Sequence from={L.c2_07.at} layout="none">
        <AbsoluteFill style={{ opacity: chartIn }}>
          <ParallaxWorld cam={cam}>
            <Layer z={0}>
              <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
                <div style={{ position: "absolute", left: 360, right: 360, top: 850, height: 2, background: C.inkFaint }} />
                {v.map((val, i) => (
                  <Bar3D key={i} x={(i - 1) * 380} h={(val / 3631) * 300} color={i === 2 ? C.amber : "#c9842f"} label={["2021-22", "2022-23", "2023-24"][i]} value={`₹${val.toLocaleString("en-IN")}`} on={bars[i]} />
                ))}
              </AbsoluteFill>
            </Layer>
          </ParallaxWorld>
          <div style={{ position: "absolute", left: 150, top: 120 }}>
            <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.3em", color: C.amber }}>GOVERNMENT INCENTIVE PAID</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 40, color: C.ink, fontWeight: 600 }}>{t("UPI + RuPay के लिए बैंकों को incentive", "Incentives paid to banks for UPI + RuPay")}</div>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Source text="PIB, Cabinet release, 19 Mar 2025" start={L.c2_07.at + 20} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S23 */
export const S23_Gap: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const tankAt = L.c2_08.at + Math.round(L.c2_08.len * L.c2_08.fr(0.3));
  const costAt = L.c2_08.at + Math.round(L.c2_08.len * L.c2_08.fr(0.55));
  const fillAt = L.c2_08.at + Math.round(L.c2_08.len * L.c2_08.fr(0.82));
  const tank = prog(frame, tankAt, 26, ease.cam);
  const fill = prog(frame, fillAt, 30, ease.out) * 0.15;
  const gapOn = prog(frame, fillAt + 30, 20);
  const TW = 520, TH = 640, TX = 1180, TY = 200;
  // before the numbers arrive: a red ghost of the tank draws itself, with an unanswered ₹ ? pulsing inside
  const ghost = prog(frame, L.c2_08.at + 6, 40, ease.cam) * (1 - tank);
  const ask = prog(frame, L.c2_08.at + 24, 16) * (1 - prog(frame, tankAt - 8, 12));
  return (
    <AbsoluteFill>
      <Backdrop hue="red" light={0.55} />
      <AbsoluteFill style={{ padding: "180px 0 0 150px" }}>
        <Words text={t("लेकिन industry कहती रही —|*ये काफ़ी नहीं।*", "But the industry kept saying —|*it's not enough.*")} start={L.c2_08.at} size={76} font={F.hiDisplay} weight={500} align="left" lineHeight={1.05} />
        <div style={{ marginTop: 50, fontFamily: F.mono, fontSize: 24, letterSpacing: "0.25em", color: C.inkDim, opacity: prog(frame, tankAt, 14) }}>
          PAYMENTS COUNCIL OF INDIA · MAR 2025
        </div>
        <div style={{ marginTop: 30, opacity: prog(frame, costAt, 14) }}>
          <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.inkDim }}>{t("UPI चलाने का सालाना ख़र्च", "Annual cost of running UPI")}</div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.ink, lineHeight: 1 }}>{t("~₹10,000 करोड़", "~₹10,000 crore")}</div>
        </div>
        <div style={{ marginTop: 24, opacity: prog(frame, fillAt, 14) }}>
          <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.inkDim }}>{t("सरकारी मदद", "Government support")}</div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.amber, lineHeight: 1 }}>{t("₹1,500 करोड़", "₹1,500 crore")}</div>
        </div>
      </AbsoluteFill>
      {ghost > 0.001 && (
        <svg width={TW + 40} height={TH + 40} style={{ position: "absolute", left: TX - 20, top: TY - 20, overflow: "visible" }}>
          <rect x={21.5} y={21.5} width={TW - 3} height={TH - 3} rx={24} fill="none" stroke={C.red} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ghost} opacity={0.75} style={{ filter: `drop-shadow(0 0 14px ${C.red})` }} />
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={i} x1={40} x2={TW} y1={60 + i * 90 + ((frame * 1.4) % 90)} y2={60 + i * 90 + ((frame * 1.4) % 90)} stroke={C.red} strokeWidth={1} opacity={0.18 * ghost} />
          ))}
        </svg>
      )}
      {ask > 0.001 && (
        <div style={{ position: "absolute", left: TX, top: TY + TH * 0.3, width: TW, textAlign: "center", opacity: ask * (0.55 + 0.25 * Math.sin(frame * 0.16)), transform: `scale(${0.9 + 0.1 * ask})` }}>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 230, color: C.red, lineHeight: 1, textShadow: `0 0 60px ${C.red}88` }}>₹ ?</div>
          <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.3em", color: C.inkDim, marginTop: 10 }}>{t("असली ख़र्च?", "THE REAL COST?")}</div>
        </div>
      )}
      {/* the tank */}
      <div style={{ position: "absolute", left: TX, top: TY, width: TW, height: TH, opacity: tank, transform: `scale(${0.9 + tank * 0.1})` }}>
        <div style={{ position: "absolute", inset: 0, border: `3px solid ${C.ink}`, borderRadius: 24, boxShadow: "0 0 60px rgba(242,239,232,0.08) inset" }} />
        {/* the unfunded part */}
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: 10,
            height: (TH - 20) * (1 - fill) - 2,
            borderRadius: 16,
            opacity: gapOn,
            background: `repeating-linear-gradient(135deg, rgba(255,59,59,0.25) 0 14px, rgba(255,59,59,0.06) 14px 28px)`,
          }}
        />
        <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, height: (TH - 20) * fill, borderRadius: 16, background: `linear-gradient(${C.amber}, #b3560f)`, boxShadow: `0 0 40px ${C.amber}` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: TH * 0.38, textAlign: "center", opacity: gapOn }}>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 96, color: C.red, lineHeight: 1 }}>~₹8,500</div>
          <div style={{ fontFamily: F.hiBody, fontSize: 32, color: C.ink }}>{t("करोड़ का अंतर", "crore gap")}</div>
          <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: "0.15em", color: C.inkDim, marginTop: 6 }}>INDUSTRY ESTIMATE</div>
        </div>
      </div>
      <Source text="Payments Council of India, Mar 2025 (via Forbes)" start={costAt} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S24 */
const EVIDENCE = [
  {
    date: "21 AUG 2022",
    who: "FINANCE MINISTRY · वित्त मंत्रालय",
    quote: "“UPI is a digital public good… There is no consideration in Government to levy any charges for UPI services.”",
    via: "via Inc42, The News Minute",
    x: -640,
    y: -70,
    rot: -3,
  },
  {
    date: "11 JUN 2025",
    who: "FINANCE MINISTRY · वित्त मंत्रालय",
    quote: "Claims that MDR will be charged on UPI are “completely false, baseless and misleading.”",
    via: "via The Tribune, Forbes",
    x: 0,
    y: 40,
    rot: 2,
  },
  {
    date: "25 JUL 2025",
    who: "RBI GOVERNOR SANJAY MALHOTRA",
    quote: "“Costs will have to be paid. Someone will have to bear the cost.”",
    via: "via IANS, Outlook Business",
    x: 640,
    y: -50,
    rot: -2,
  },
];

export const S24_Memory: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const starts = [L.c2_12.at, L.c2_13.at, L.c2_14.at];
  // camera visits each card, then pulls back on the last beat
  const cx = keys(frame, [
    [0, 0],
    [starts[0], EVIDENCE[0].x * 0.85],
    [starts[1] - 10, EVIDENCE[0].x * 0.85],
    [starts[1] + 10, EVIDENCE[1].x],
    [starts[2] - 10, EVIDENCE[1].x],
    [starts[2] + 10, EVIDENCE[2].x * 0.85],
    [L.c2_14.at + Math.round(L.c2_14.len * L.c2_14.fr(0.75)), EVIDENCE[2].x * 0.85],
    [seg.frames, 0],
  ]);
  const cz = keys(frame, [
    [0, -700],
    [starts[0], 380],
    [starts[2] + 10, 380],
    [L.c2_14.at + Math.round(L.c2_14.len * L.c2_14.fr(0.75)), 420],
    [seg.frames, -260],
  ]);
  const cam = { x: cx, y: drift(frame, 3, 10), z: cz, ry: keys(frame, [[0, 0], [seg.frames, -3]]) };
  const thread = prog(frame, starts[1] - 6, starts[2] - starts[1], ease.soft);
  const thread2 = prog(frame, starts[2] - 6, 40, ease.soft);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #1a1712 0%, #0a0907 70%)" }} />
      <ParallaxWorld cam={cam}>
        {/* wall texture */}
        <Layer z={-300}>
          <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 9px), radial-gradient(ellipse at 50% 30%, rgba(255,190,120,0.08), transparent 60%)" }} />
        </Layer>
        <Layer z={-40}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            {(() => {
              const p = EVIDENCE.map((e) => [960 + e.x, 540 + e.y - 250]);
              const seg1 = `M${p[0][0]},${p[0][1]} Q${(p[0][0] + p[1][0]) / 2},${p[0][1] + 120} ${p[1][0]},${p[1][1]}`;
              const seg2 = `M${p[1][0]},${p[1][1]} Q${(p[1][0] + p[2][0]) / 2},${p[1][1] + 140} ${p[2][0]},${p[2][1]}`;
              return (
                <>
                  <path d={seg1} stroke="#d0342c" strokeWidth={4} fill="none" strokeDasharray={1200} strokeDashoffset={1200 * (1 - thread)} />
                  <path d={seg2} stroke="#d0342c" strokeWidth={4} fill="none" strokeDasharray={1200} strokeDashoffset={1200 * (1 - thread2)} />
                </>
              );
            })()}
          </svg>
        </Layer>
        {EVIDENCE.map((e, i) => {
          const on = prog(frame, starts[i] - 8, 18, ease.out);
          const typed = Math.floor(interpolate(frame, [starts[i] + 6, starts[i] + 6 + e.quote.length * 0.9], [0, e.quote.length], clamp));
          return (
            <Layer key={i} z={0} x={e.x} y={e.y}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div
                  style={{
                    width: 540,
                    padding: "34px 34px 26px",
                    background: "linear-gradient(170deg, #f4eee2, #e4dccb)",
                    color: C.paperInk,
                    transform: `rotate(${e.rot}deg) translateY(${(1 - on) * 40}px)`,
                    opacity: on,
                    boxShadow: "0 30px 80px rgba(0,0,0,0.75)",
                    position: "relative",
                  }}
                >
                  <div style={{ position: "absolute", top: -16, left: "50%", marginLeft: -16, width: 32, height: 32, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #ff7b6b, #a3140c)", boxShadow: "0 6px 10px rgba(0,0,0,0.5)" }} />
                  <div style={{ fontFamily: F.mono, fontSize: 30, fontWeight: 600, letterSpacing: "0.2em" }}>{e.date}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: "0.12em", opacity: 0.65, marginTop: 6 }}>{t(e.who, e.who.split(" · ")[0])}</div>
                  <div style={{ fontFamily: F.serif, fontSize: 38, lineHeight: 1.22, marginTop: 18, minHeight: 190, fontWeight: 500 }}>{e.quote.slice(0, typed)}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: "0.1em", opacity: 0.55, marginTop: 12 }}>{e.via}</div>
                </div>
              </AbsoluteFill>
            </Layer>
          );
        })}
      </ParallaxWorld>
      {/* the 6-week gap */}
      <Sequence from={L.c2_14.at + Math.round(L.c2_14.len * L.c2_14.fr(0.75))} layout="none">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
          <div style={{ fontFamily: F.mono, fontSize: 30, letterSpacing: "0.3em", color: C.amber, opacity: prog(frame - L.c2_14.at - Math.round(L.c2_14.len * L.c2_14.fr(0.75)), 6, 12) }}>
            {t("11 JUN → 25 JUL 2025 · सिर्फ़ 6 हफ़्ते", "11 JUN → 25 JUL 2025 · JUST 6 WEEKS")}
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence durationInFrames={starts[0]} layout="none">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
          <Words text={t("और इस पूरे वक़्त, सरकार का जवाब... *एक ही था।*", "And all this time, the answer... *was the same.*")} start={L.c2_11.at} size={56} />
        </AbsoluteFill>
      </Sequence>
      <LightLeak start={starts[2]} dur={120} strength={0.3} />
      <Dust count={50} color="255,220,180" />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S25 */
export const S25_Budget: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const drop = prog(frame, L.c2_15.at + Math.round(L.c2_15.len * L.c2_15.fr(0.55)), 30, ease.cam);
  const ghost = prog(frame, L.c2_16.at, 40, ease.soft);
  const flicker = 0.75 + 0.25 * Math.sin(frame * 0.9) * Math.sin(frame * 0.37);
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.6} />
      {/* the ghost bill — present all along, only now visible */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: ghost * 0.55 * flicker }}>
        <div style={{ width: 620, height: 860, border: "2px dashed rgba(255,165,58,0.7)", borderRadius: 6, padding: 40, transform: `rotate(-4deg) scale(${1 + ghost * 0.05})`, boxShadow: "0 0 80px rgba(255,165,58,0.25)" }}>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 90, color: C.amber, textAlign: "center", letterSpacing: "0.1em" }}>{t("BILL · बिल", "THE BILL")}</div>
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} style={{ height: 14, marginTop: 30, width: `${60 + rand(i) * 40}%`, background: "rgba(255,165,58,0.35)", borderRadius: 4 }} />
          ))}
        </div>
      </AbsoluteFill>
      {/* the budget line */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - ghost * 0.85 }}>
        <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.35em", color: C.amber, marginBottom: 30 }}>UNION BUDGET 2026-27</div>
        <div style={{ display: "flex", alignItems: "center", gap: 70 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 150, color: C.ink, lineHeight: 1 }}>₹2,196</div>
            <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.2em", color: C.inkDim }}>{t("FY26 (REVISED) · करोड़", "FY26 (REVISED) · CRORE")}</div>
          </div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.red, transform: `translateY(${drop * 30}px)`, opacity: prog(frame, L.c2_15.at + 20, 10) }}>↘</div>
          <div style={{ textAlign: "center", opacity: prog(frame, L.c2_15.at + Math.round(L.c2_15.len * L.c2_15.fr(0.5)), 14), transform: `translateY(${drop * 40}px)` }}>
            <Counter from={2196} to={2000} start={L.c2_15.at + Math.round(L.c2_15.len * L.c2_15.fr(0.55))} dur={30} size={150} color={C.amber} prefix="₹" indian={false} />
            <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.2em", color: C.inkDim }}>{t("FY27 (BUDGET) · करोड़", "FY27 (BUDGET) · CRORE")}</div>
          </div>
        </div>
        <div style={{ marginTop: 40, fontFamily: F.hiDisplay, fontSize: 70, color: C.red, opacity: drop }}>{t("~10% कम", "~10% LESS")}</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
        <Sequence from={L.c2_16.at} layout="none">
          <Words text={t("बिल ग़ायब नहीं हुआ था। बस... *किसी को दिख नहीं रहा था।*", "The bill hadn't vanished. It just... *wasn't visible.*")} start={2} size={54} />
        </Sequence>
      </AbsoluteFill>
      <Source text="BW Businessworld · Finance Outlook India" start={L.c2_15.at + 20} out={L.c2_16.at} y={970} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};
