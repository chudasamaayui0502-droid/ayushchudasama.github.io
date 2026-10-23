import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { SceneProps, relLines } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog, rand } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Counter, Dateline, Source, Stamp, Words } from "../components/Type";
import { Icon, IconName } from "../components/Icons";
import { Layer, ParallaxWorld } from "../components/Parallax";
import { DocPage, PhotoPlate } from "../components/Media";
import { CamRig, RupeeField, Stage } from "../three/kit";
import india from "../data/india.json";

/* ---------------------------------------------------------------- S30 */
export const S30_Law: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const stampAt = L.c3_01.at + Math.round(L.c3_01.len * L.c3_01.fr(0.45));
  const assentAt = L.c3_01.at + Math.round(L.c3_01.len * L.c3_01.fr(0.72));
  const cam = { x: drift(frame, 2, 20), y: keys(frame, [[0, 40], [seg.frames, -30]]), z: keys(frame, [[0, -120], [seg.frames, 160]]), ry: keys(frame, [[0, -6], [seg.frames, 4]]) };
  return (
    <AbsoluteFill>
      <PhotoPlate name="parliament" dur={seg.frames} fallback={<Backdrop hue="neutral" light={0.7} />} />
      <ParallaxWorld cam={cam}>
        <Layer z={-260}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 0.18 }}>
            <Icon name="govt" start={0} size={900} color={C.ink} width={3} dur={40} />
          </AbsoluteFill>
        </Layer>
        <Layer z={0}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", opacity: prog(frame, L.c3_01.at, 18), transform: `translateY(${(1 - prog(frame, L.c3_01.at, 18)) * 30}px)` }}>
              <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.4em", color: C.amber }}>{t("PARLIAMENT OF INDIA · संसद", "PARLIAMENT OF INDIA")}</div>
              <div style={{ fontFamily: F.serif, fontSize: 84, color: C.ink, lineHeight: 1.08, marginTop: 20, fontWeight: 500 }}>
                The Payment and Settlement
                <br />
                Systems Act, 2007
              </div>
            </div>
            <div style={{ marginTop: 40 }}>
              <Stamp text="AMENDED · 2026" at={stampAt} color={C.amber} size={70} rotate={-4} />
            </div>
            <div style={{ marginTop: 40, fontFamily: F.mono, fontSize: 30, letterSpacing: "0.22em", color: C.ink, opacity: prog(frame, assentAt, 14) }}>
              {t("17.08.2026 — PRESIDENT'S ASSENT · राष्ट्रपति की मंज़ूरी", "17.08.2026 — PRESIDENT'S ASSENT")}
            </div>
          </AbsoluteFill>
        </Layer>
      </ParallaxWorld>
      <Dateline en="AUG 2026" hi={t("अगस्त 2026", "August 2026")} start={L.c3_01.at} />
      <Source text="Outlook Business, Ministry of Law gazette (Aug 2026)" start={assentAt} />
      <Flash at={stampAt} peak={0.2} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S31 */
export const S31_Notification: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const second = L.c3_02.at + Math.round(L.c3_02.len * L.c3_02.fr(0.55));
  const a = prog(frame, L.c3_02.at, 26, ease.cam);
  const b = prog(frame, second, 26, ease.cam);
  const cam = { x: keys(frame, [[0, -220], [second, -150], [seg.frames, 180]]), y: -20 + drift(frame, 3, 8), z: keys(frame, [[0, -180], [seg.frames, 60]]), ry: keys(frame, [[0, 8], [seg.frames, -8]]) };
  return (
    <AbsoluteFill>
      <Backdrop hue="neutral" light={0.8} />
      <ParallaxWorld cam={cam}>
        <Layer z={-80} x={-230} y={60 + (1 - a) * 400} rotateY={10} opacity={a}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ transform: "rotate(-3deg)" }}>
              <DocPage name="mof_notification_2026-09-14" title={t("वित्त मंत्रालय — Notification", "Finance Ministry — Notification")} date="14 SEP 2026" width={440} highlight={{ top: 38, height: 5, p: prog(frame, L.c3_02.at + 30, 30) }} />
            </div>
          </AbsoluteFill>
        </Layer>
        <Layer z={20} x={330} y={30 + (1 - b) * 400} rotateY={-8} opacity={b}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ transform: "rotate(2.5deg)" }}>
              <DocPage name="npci_circular_2026-09-15" title="NPCI — Operational Circular" date="15 SEP 2026" width={440} highlight={{ top: 44, height: 5, p: prog(frame, second + 24, 30) }} />
            </div>
          </AbsoluteFill>
        </Layer>
      </ParallaxWorld>
      <Dateline en="14 SEP 2026" hi={t("14 सितंबर 2026", "14 September 2026")} start={L.c3_02.at} />
      <Source text="Finance Ministry notification (14 Sep) · NPCI circular (15 Sep) — via TechCrunch" start={second} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S32 */
const RULES = [
  { k: "c3_04", n: "01", t: "₹2,000+ → 0.4%" },
  { k: "c3_05", n: "02", t: "MAX ₹300" },
  { k: "c3_06", n: "03", t: "FLAT ₹5" },
  { k: "c3_07", n: "04", t: "EXEMPT" },
  { k: "c3_08", n: "05", t: "CUSTOMER ₹0" },
];

const Panel: React.FC<{ children: React.ReactNode; at: number; end: number }> = ({ children, at, end }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  if (frame < at - 2 || frame > end + 14) return null;
  const p = prog(frame, at, 16, ease.out);
  const o = 1 - prog(frame, end, 12, ease.in);
  return (
    <AbsoluteFill style={{ left: 640, right: 100, width: "auto", opacity: p * o, transform: `translateX(${(1 - p) * 80 - (1 - o) * 60}px)`, alignItems: "center", justifyContent: "center" }}>
      {children}
    </AbsoluteFill>
  );
};

const FeeGraph: React.FC<{ t: number }> = ({ t }) => {
  // x: amount ₹0..₹1,00,000 ; y: fee ₹0..₹400
  const W0 = 900, H0 = 440, X0 = 80, Y0 = 520;
  const X = (a: number) => X0 + (a / 100000) * W0;
  const Y = (f: number) => Y0 - (f / 400) * H0;
  const pts = Array.from({ length: 201 }, (_, i) => {
    const a = (i / 200) * 100000;
    const fee = a <= 2000 ? 0 : Math.min(300, a * 0.004);
    return [X(a), Y(fee)];
  });
  const n = Math.max(2, Math.floor(t * pts.length));
  const d = pts.slice(0, n).map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const nocap = `M${X(75000)},${Y(300)} L${X(100000)},${Y(400)}`;
  return (
    <svg width={1100} height={640}>
      <line x1={X0} y1={Y0} x2={X0 + W0} y2={Y0} stroke={C.inkFaint} strokeWidth={2} />
      <line x1={X0} y1={Y0} x2={X0} y2={Y0 - H0} stroke={C.inkFaint} strokeWidth={2} />
      <path d={nocap} stroke={C.inkFaint} strokeWidth={3} strokeDasharray="10 10" opacity={t > 0.95 ? 1 : 0} />
      <path d={d} stroke={C.amber} strokeWidth={6} fill="none" style={{ filter: "drop-shadow(0 0 10px rgba(255,165,58,0.8))" }} />
      {t > 0.75 && (
        <>
          <circle cx={X(75000)} cy={Y(300)} r={10} fill="#fff" />
          <text x={X(75000)} y={Y(300) - 26} fill={C.ink} fontFamily="Teko" fontSize={48} textAnchor="middle">₹300 CAP</text>
        </>
      )}
      <text x={X(2000) + 8} y={Y0 + 40} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={20}>₹2,000</text>
      <text x={X(75000)} y={Y0 + 40} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={20} textAnchor="middle">₹75,000</text>
      <text x={X(100000)} y={Y0 + 40} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={20} textAnchor="end">₹1,00,000</text>
      <text x={X0 - 14} y={Y0 - H0 + 10} fill={C.inkDim} fontFamily="IBM Plex Mono" fontSize={18} textAnchor="end">FEE</text>
      <text x={X0 + W0} y={Y0 + 76} fill="rgba(242,239,232,0.4)" fontFamily="IBM Plex Mono" fontSize={18} textAnchor="end">PAYMENT AMOUNT →</text>
    </svg>
  );
};

export const S32_Rules: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const active = RULES.findIndex((r, i) => frame >= L[r.k].at - 4 && (i === RULES.length - 1 || frame < L[RULES[i + 1].k].at - 4));
  const r1 = L.c3_04;
  const calcStep = (k: number) => prog(frame, r1.at + Math.round(r1.len * (0.25 + k * 0.2)), 12, ease.out);
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.55} grid />
      {/* intro line */}
      <Sequence durationInFrames={L.c3_04.at} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Words text={t("नियम *सीधा* है।", "The rule is *simple.*")} start={L.c3_03.at} size={120} font={F.hiDisplay} weight={500} mode="punch" />
        </AbsoluteFill>
      </Sequence>
      {/* rule index */}
      <Sequence from={L.c3_04.at - 4} layout="none">
        <div style={{ position: "absolute", left: 140, top: 210 }}>
          <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.35em", color: C.amber, marginBottom: 26 }}>{t("THE RULE · नियम", "THE RULE")}</div>
          {RULES.map((r, i) => {
            const on = i === active;
            const seen = i <= active;
            return (
              <div key={r.n} style={{ display: "flex", alignItems: "baseline", gap: 22, marginBottom: 26, opacity: seen ? (on ? 1 : 0.42) : 0.12, transform: `translateX(${on ? 16 : 0}px)` }}>
                <div style={{ fontFamily: F.mono, fontSize: 26, color: on ? C.amber : C.inkDim }}>{r.n}</div>
                <div style={{ fontFamily: F.hiDisplay, fontSize: 64, color: C.ink, lineHeight: 1 }}>{r.t}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 600, top: 200, bottom: 200, width: 1, background: C.inkFaint }} />
      </Sequence>

      {/* 01 — the calculator */}
      <Panel at={L.c3_04.at} end={L.c3_05.at - 6}>
        <div style={{ width: 980 }}>
          <div style={{ fontFamily: F.hiBody, fontSize: 38, color: C.inkDim, opacity: calcStep(0) }}>{t("Merchant payment · दुकान पर payment", "Merchant payment")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 30, marginTop: 10 }}>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 170, color: C.ink, lineHeight: 1, opacity: calcStep(0) }}>₹2,500</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 110, color: C.amber, opacity: calcStep(1) }}>× 0.4%</div>
          </div>
          <div style={{ height: 2, background: C.inkFaint, margin: "16px 0 22px", width: 980 * calcStep(2) }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 26, opacity: calcStep(2) }}>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 150, color: C.amber, lineHeight: 1 }}>= ₹10</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 40, color: C.ink }}>{t("MDR — दुकानदार देगा", "MDR — paid by the shop")}</div>
          </div>
          <div style={{ marginTop: 40, fontFamily: F.mono, fontSize: 28, letterSpacing: "0.12em", color: C.green, opacity: calcStep(3) }}>{t("₹2,000 तक के payments → ₹0", "Payments up to ₹2,000 → ₹0")}</div>
        </div>
      </Panel>
      {/* 02 — the cap */}
      <Panel at={L.c3_05.at} end={L.c3_06.at - 6}>
        <FeeGraph t={prog(frame, L.c3_05.at + 6, L.c3_05.len * L.c3_05.fr(0.7), ease.soft)} />
      </Panel>
      {/* 03 — flat ₹5 */}
      <Panel at={L.c3_06.at} end={L.c3_07.at - 6}>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "flex", gap: 70, justifyContent: "center" }}>
            {(
              [
                ["train", "RAILWAYS"],
                ["tower", "TELECOM"],
                ["umbrella", "INSURANCE"],
                ["fuel", "FUEL"],
              ] as [IconName, string][]
            ).map(([ic, lb], i) => (
              <div key={lb} style={{ opacity: prog(frame, L.c3_06.at + 6 + i * 10, 10) }}>
                <Icon name={ic} start={L.c3_06.at + 6 + i * 10} size={150} color={C.ink} width={8} dur={16} />
                <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.2em", color: C.inkDim, marginTop: 6 }}>{lb}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 200, color: C.amber, lineHeight: 1, marginTop: 30, opacity: prog(frame, L.c3_06.at + Math.round(L.c3_06.len * L.c3_06.fr(0.6)), 8), textShadow: `0 0 50px ${C.amber}66` }}>FLAT ₹5</div>
          <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.2em", color: C.inkDim }}>PER PAYMENT ABOVE ₹2,000</div>
        </div>
      </Panel>
      {/* 04 — exemptions */}
      <Panel at={L.c3_07.at} end={L.c3_08.at - 6}>
        <div style={{ display: "flex", gap: 80, alignItems: "flex-start" }}>
          <div style={{ textAlign: "center", width: 440 }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <Icon name="person" start={L.c3_07.at + 4} size={130} color={C.ink} width={9} />
              <div style={{ fontFamily: F.hiDisplay, fontSize: 70, color: C.teal }}>⇄</div>
              <Icon name="person" start={L.c3_07.at + 10} size={130} color={C.ink} width={9} />
            </div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.green, lineHeight: 1 }}>₹0</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 36, color: C.ink }}>Person-to-person</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 30, color: C.inkDim }}>{t("आपस में भेजा पैसा — फ़्री", "Between people — free")}</div>
          </div>
          <div style={{ width: 1, height: 420, background: C.inkFaint }} />
          <div style={{ textAlign: "center", width: 440, opacity: prog(frame, L.c3_07.at + Math.round(L.c3_07.len * L.c3_07.fr(0.45)), 14) }}>
            <Icon name="shop" start={L.c3_07.at + Math.round(L.c3_07.len * L.c3_07.fr(0.45))} size={150} color={C.ink} width={8} />
            <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.green, lineHeight: 1 }}>₹0</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 36, color: C.ink }}>{t("छोटे दुकानदार", "Small shops")}</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 30, color: C.inkDim }}>{t("UPI से ₹1 लाख/महीना तक", "Up to ₹1 lakh/month via UPI")}</div>
          </div>
        </div>
      </Panel>
      {/* 05 — the customer pays nothing */}
      <Panel at={L.c3_08.at} end={seg.frames + 20}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.3em", color: C.inkDim }}>{t("CUSTOMER PAYS · आप देंगे", "CUSTOMER PAYS")}</div>
          <div style={{ fontFamily: F.hiDisplay, fontSize: 300, color: C.green, lineHeight: 0.95, textShadow: `0 0 60px ${C.green}55` }}>₹0</div>
          <div style={{ marginTop: 20 }}>
            <Stamp text={t("दुकानदार देगा", "THE SHOP PAYS")} at={L.c3_08.at + Math.round(L.c3_08.len * L.c3_08.fr(0.62))} color={C.amber} size={80} rotate={-5} />
          </div>
        </div>
      </Panel>
      <Source text="NPCI circular · TechCrunch, AIR, ThePrint (Sep 2026)" start={L.c3_04.at + 20} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S33 */
export const S33_Revenue: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={1} />
      <Stage env={false}>
        <CamRig pos={[0, 0, keys(frame, [[0, 12], [seg.frames, 7]])]} />
        <RupeeField count={300} opacity={0.5} speed={-2.5} />
      </Stage>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.35em", color: C.inkDim }}>{t("NPCI ESTIMATE · हर साल", "NPCI ESTIMATE · PER YEAR")}</div>
        <Counter to={20600} start={L.c3_09.at + Math.round(L.c3_09.len * L.c3_09.fr(0.35))} dur={50} size={230} color={C.amber} prefix="₹" indian={false} />
        <div style={{ fontFamily: F.hiDisplay, fontSize: 90, color: C.ink, lineHeight: 1, marginTop: -10 }}>{t("करोड़ तक", "crore, at most")}</div>
      </AbsoluteFill>
      <Source text="Business Standard, 18 Sep 2026" start={L.c3_09.at + 20} />
      <LightLeak start={0} dur={seg.frames} strength={0.35} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S34 */
const Donut: React.FC<{ pct: number; t: number; label: string; sub: string; color?: string }> = ({ pct, t, label, sub, color = C.red }) => {
  const R = 190;
  const circ = 2 * Math.PI * R;
  return (
    <div style={{ position: "relative", width: 480, height: 480 }}>
      <svg width={480} height={480} viewBox="-240 -240 480 480">
        <circle r={R} fill="none" stroke="rgba(242,239,232,0.1)" strokeWidth={36} />
        <circle r={R} fill="none" stroke={color} strokeWidth={36} strokeDasharray={`${circ * (pct / 100) * t} ${circ}`} transform="rotate(-90)" style={{ filter: `drop-shadow(0 0 14px ${color})` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 150, color: C.ink, lineHeight: 0.9 }}>{Math.round(pct * t)}%</div>
        <div style={{ fontFamily: F.hiBody, fontSize: 30, color: C.ink, textAlign: "center", width: 300, lineHeight: 1.2 }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: "0.15em", color: C.inkDim, marginTop: 8 }}>{sub}</div>
      </div>
    </div>
  );
};

/** Time-lapse countdown to 15 Oct 2026 00:00 IST, starting from 15 Sep. */
export const Countdown: React.FC<{ remainingSec: number; size?: number; color?: string }> = ({ remainingSec, size = 90, color = C.ink }) => {
  const s = Math.max(0, remainingSec);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    <div style={{ fontFamily: F.mono, fontSize: size, color, fontWeight: 500, letterSpacing: "0.04em", fontVariantNumeric: "tabular-nums" }}>
      {pad(d)}<span style={{ fontSize: size * 0.35, color: C.inkDim }}>D </span>
      {pad(h)}:{pad(m)}:{pad(sec)}
    </div>
  );
};

export const S34_Countdown: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  // 30 days → ~4 days over the scene (time-lapse)
  const remaining = interpolate(frame, [0, seg.frames], [30 * 86400, 4.2 * 86400], clamp) - (frame % 30) * 37;
  const big = 1 - prog(frame, L.c3_11.at - 10, 24, ease.cam);
  const d1 = prog(frame, L.c3_11.at + Math.round(L.c3_11.len * L.c3_11.fr(0.35)), 50, ease.cam);
  const d2 = prog(frame, L.c3_12.at + Math.round(L.c3_12.len * L.c3_12.fr(0.3)), 50, ease.cam);
  return (
    <AbsoluteFill>
      <Backdrop hue="red" light={0.55} />
      {/* the clock: big first, then docks to the top-right */}
      <div
        style={{
          position: "absolute",
          left: interpolate(big, [0, 1], [1380, 960]),
          top: interpolate(big, [0, 1], [110, 470]),
          transform: `translate(-50%, -50%) scale(${interpolate(big, [0, 1], [0.42, 1.25])})`,
          textAlign: "center",
          transformOrigin: "50% 50%",
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ fontFamily: F.mono, fontSize: 28, letterSpacing: "0.35em", color: C.red }}>T-MINUS · 15 OCT 2026</div>
        <Countdown remainingSec={remaining} size={130} />
      </div>
      <Sequence durationInFrames={L.c3_11.at} layout="none">
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 200 }}>
          <Words text={t("और फिर... शुरू हुआ *countdown।*", "And then... the *countdown began.*")} start={L.c3_10.at} size={64} accent={C.red} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={L.c3_11.at} layout="none">
        <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 180, paddingTop: 80 }}>
          <div style={{ opacity: prog(frame - L.c3_11.at, 4, 16) }}>
            <Donut pct={17} t={d1} label={t("दुकानदार fee ख़ुद उठाने को तैयार", "merchants willing to absorb the fee")} sub="32,000+ MERCHANTS" color={C.amber} />
          </div>
          <div style={{ opacity: prog(frame, L.c3_12.at, 16) }}>
            <Donut pct={14} t={d2} label={t("users, fee उन पर आए तो भी UPI पर", "users who'd stay on UPI if charged")} sub="67,000+ USERS" color={C.red} />
          </div>
        </AbsoluteFill>
      </Sequence>
      <Source text="LocalCircles surveys (Sep 2026) — via Business Standard, BW Businessworld" start={L.c3_11.at + 20} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S35 */
export const S35_Map: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const draw = prog(frame, 0, 60, ease.soft);
  const pinsAt = L.c3_13.at + 30;
  const extraAt = L.c3_13.at + Math.round(L.c3_13.len * L.c3_13.fr(0.72));
  const zoom = keys(frame, [[0, 0.82], [pinsAt, 0.86], [seg.frames, 1.25]]);
  const [vw, vh] = [india.viewBox[2], india.viewBox[3]];
  const pins: { k: keyof typeof india.points; label: string; at: number }[] = [
    { k: "MP", label: t("मध्य प्रदेश", "Madhya Pradesh"), at: pinsAt },
    { k: "Punjab", label: t("पंजाब", "Punjab"), at: extraAt },
    { k: "Haryana", label: t("हरियाणा", "Haryana"), at: extraAt + 10 },
  ];
  // focus between MP and north
  const fx = india.points.MP[0] * 0.6 + india.points.Punjab[0] * 0.4;
  const fy = india.points.MP[1] * 0.6 + india.points.Punjab[1] * 0.4;
  const S = 0.85 * zoom;
  return (
    <AbsoluteFill>
      <Backdrop hue="amber" light={0.5} />
      <AbsoluteFill style={{ perspective: 1600 }}>
        <div
          style={{
            position: "absolute",
            left: 540 - fx * S,
            top: 540 - fy * S,
            width: vw,
            height: vh,
            transform: `scale(${S}) rotateX(${keys(frame, [[0, 18], [seg.frames, 8]])}deg)`,
            transformOrigin: `${fx}px ${fy}px`,
          }}
        >
          <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`} style={{ overflow: "visible" }}>
            <path d={india.path} fill={`rgba(255,165,58,${0.05 + draw * 0.07})`} stroke={C.amber} strokeWidth={2.4} strokeDasharray={9000} strokeDashoffset={9000 * (1 - draw)} style={{ filter: "drop-shadow(0 0 8px rgba(255,165,58,0.6))" }} />
            {pins.map((p) => {
              const on = prog(frame, p.at, 12, ease.out);
              const [x, y] = india.points[p.k];
              const pulse = ((frame - p.at) % 40) / 40;
              return (
                <g key={p.k} opacity={on}>
                  <circle cx={x} cy={y} r={10 + pulse * 40} fill="none" stroke={C.red} strokeWidth={3} opacity={1 - pulse} />
                  <circle cx={x} cy={y} r={11} fill={C.red} />
                  <text x={x + 22} y={y + 10} fill={C.ink} fontFamily="Mukta" fontWeight={700} fontSize={34}>{p.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </AbsoluteFill>
      {/* callout */}
      <div style={{ position: "absolute", right: 110, top: 220, width: 600, opacity: prog(frame, pinsAt + 10, 16), transform: `translateX(${(1 - prog(frame, pinsAt + 10, 16)) * 40}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <Icon name="fuel" start={pinsAt + 10} size={140} color={C.red} width={9} />
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.25em", color: C.red }}>PETROL PUMP DEALERS</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 80, color: C.ink, lineHeight: 1 }}>₹2,000+ UPI ✕</div>
            <div style={{ fontFamily: F.hiBody, fontSize: 34, color: C.inkDim }}>{t("16 अक्टूबर से — ऐलान", "announced: from 16 October")}</div>
          </div>
        </div>
        <div style={{ marginTop: 34, fontFamily: F.hiBody, fontSize: 34, color: C.ink, opacity: prog(frame, extraAt, 14) }}>{t("पंजाब और हरियाणा से भी यही ऐलान", "Punjab and Haryana dealers said the same")}</div>
      </div>
      <Source text="ANI (19 Sep 2026) · Daily Jagran — map: datameet (official boundary)" start={pinsAt} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S36 */
const CourtArt: React.FC<{ t: number }> = ({ t }) => {
  // stylised line drawing: central dome over a colonnaded block, scales of justice above
  const len = 2600;
  const p = (d: string, w = 3) => <path d={d} fill="none" stroke={C.ink} strokeWidth={w} strokeDasharray={len} strokeDashoffset={len * (1 - t)} strokeLinecap="round" />;
  return (
    <svg width={1100} height={520} viewBox="0 0 1100 520" style={{ filter: "drop-shadow(0 0 10px rgba(242,239,232,0.25))" }}>
      {p("M60 470 L1040 470")}
      {p("M120 470 L120 300 L980 300 L980 470")}
      {Array.from({ length: 15 }).map((_, i) => p(`M${170 + i * 54} 465 L${170 + i * 54} 315`, 2))}
      {p("M100 300 L550 230 L1000 300")}
      {p("M430 230 Q430 110 550 90 Q670 110 670 230")}
      {p("M550 90 L550 40")}
      {p("M500 60 L600 60 M500 60 L485 95 L515 95 Z M600 60 L585 95 L615 95 Z", 2)}
    </svg>
  );
};

export const S36_Court: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const noStay = L.c3_14.at + Math.round(L.c3_14.len * L.c3_14.fr(0.42));
  const replyAt = L.c3_14.at + Math.round(L.c3_14.len * L.c3_14.fr(0.7));
  const quote = prog(frame, L.c3_15.at, 24, ease.cam);
  return (
    <AbsoluteFill>
      <PhotoPlate name="supreme_court" dur={seg.frames} fallback={<Backdrop hue="neutral" light={0.7} />} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - quote * 0.8, transform: `scale(${keys(frame, [[0, 1], [seg.frames, 1.08]])}) translateY(-60px)` }}>
        <CourtArt t={prog(frame, 0, 70, ease.soft)} />
        <div style={{ fontFamily: F.wide, fontWeight: 300, fontSize: 40, letterSpacing: "0.5em", paddingLeft: "0.5em", color: C.ink, marginTop: 14 }}>SUPREME COURT OF INDIA</div>
      </AbsoluteFill>
      <Dateline en="28 SEP 2026" hi={t("28 सितंबर 2026", "28 September 2026")} start={L.c3_14.at} out={L.c3_15.at} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150, opacity: 1 - quote }}>
        <div style={{ display: "flex", gap: 40 }}>
          <div style={{ opacity: prog(frame, noStay, 10) }}>
            <Stamp text={t("NO STAY · रोक नहीं", "NO STAY")} at={noStay} color={C.red} size={64} rotate={-3} />
          </div>
          <div style={{ opacity: prog(frame, replyAt, 14), padding: "10px 30px", border: `2px solid ${C.inkFaint}`, borderRadius: 12 }}>
            <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.2em", color: C.inkDim }}>NOTICE TO</div>
            <div style={{ fontFamily: F.hiDisplay, fontSize: 56, color: C.ink, lineHeight: 1.05 }}>{t("Centre · RBI · NPCI — 4 हफ़्ते", "Centre · RBI · NPCI — 4 weeks")}</div>
          </div>
        </div>
      </AbsoluteFill>
      {/* the line from the government's counsel */}
      <Sequence from={L.c3_15.at} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: quote }}>
          <div style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 120, color: C.ink, textAlign: "center", lineHeight: 1.1, maxWidth: 1500 }}>
            <Words text="“It is neither a *tax* nor a *fee*.”" start={Math.round(L.c3_15.len * L.c3_15.fr(0.3))} size={120} font={F.serif} weight={500} stagger={5} />
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.25em", color: C.inkDim, marginTop: 30, opacity: prog(frame - L.c3_15.at, 30, 14) }}>
            — ADDITIONAL SOLICITOR GENERAL, FOR THE CENTRE
          </div>
        </AbsoluteFill>
      </Sequence>
      <Source text="ThePrint (PTI), Telangana Today — 28 Sep 2026" start={L.c3_14.at + 20} />
      <Dust count={40} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- S37 */
export const S37_Deferral: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const freezeAt = L.c3_16.end - 6;
  const frozen = frame >= freezeAt;
  // 13 Oct 00:00 → counts down until it freezes ~T-2 days
  const remaining = frozen ? 2 * 86400 - 37 * 60 : interpolate(frame, [0, freezeAt], [2.6 * 86400, 2 * 86400 - 37 * 60], clamp);
  const glitch = frozen && frame - freezeAt < 16 ? (rand(frame) - 0.5) * 30 : 0;
  const stampAt = L.c3_17.at + Math.round(L.c3_17.len * L.c3_17.fr(0.18));
  const qAt = L.c3_17.at + Math.round(L.c3_17.len * L.c3_17.fr(0.55));
  return (
    <AbsoluteFill>
      <Backdrop hue={frozen ? "amber" : "red"} light={0.6} />
      <Dateline en="13 OCT 2026" hi={t("13 अक्टूबर 2026", "13 October 2026")} start={L.c3_16.at} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateX(${glitch}px) translateY(${frozen ? -140 : 0}px) scale(${frozen ? 0.8 : 1})`, transition: "none" }}>
        <div style={{ fontFamily: F.mono, fontSize: 28, letterSpacing: "0.35em", color: frozen ? C.inkDim : C.red, textAlign: "center" }}>T-MINUS · 15 OCT 2026</div>
        <div style={{ filter: frozen ? "grayscale(1) blur(0.5px)" : undefined, opacity: frozen ? 0.6 : 1 }}>
          <Countdown remainingSec={remaining} size={170} color={frozen ? C.inkDim : C.ink} />
        </div>
      </AbsoluteFill>
      {frozen && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 260 }}>
          <Stamp text={t("DEFERRED · टला", "DEFERRED")} at={stampAt} color={C.amber} size={110} rotate={-6} sub="NPCI · AFTER DIWALI" />
          <div style={{ marginTop: 40, fontFamily: F.hiDisplay, fontSize: 90, color: C.ink, opacity: prog(frame, qAt, 10) }}>
            {t("नई तारीख़? ", "New date? ")}<span style={{ color: C.amber }}>{t("अभी तय नहीं।", "Not decided yet.")}</span>
          </div>
        </AbsoluteFill>
      )}
      {/* diyas: Diwali glow along the bottom */}
      {frozen && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {Array.from({ length: 9 }).map((_, i) => {
            const fl = 0.7 + 0.3 * Math.sin(frame * 0.5 + i * 1.7) * Math.sin(frame * 0.23 + i);
            return (
              <div key={i} style={{ position: "absolute", left: 150 + i * 200, bottom: 90, width: 26, height: 40, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "radial-gradient(circle at 50% 70%, #fff6d0, #ffb347 45%, rgba(255,120,20,0) 72%)", opacity: prog(frame, stampAt + i * 3, 10) * fl, boxShadow: `0 0 ${50 * fl}px 18px rgba(255,150,40,0.35)` }} />
            );
          })}
        </AbsoluteFill>
      )}
      <Flash at={freezeAt} peak={0.4} color="255,200,120" />
      <Source text="NPCI via PTI (ThePrint), The Tribune — 13 Oct 2026" start={stampAt} />
      <Letterbox amount={0.45} />
    </AbsoluteFill>
  );
};

