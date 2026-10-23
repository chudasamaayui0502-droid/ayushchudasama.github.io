import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { useLang, useT } from "../lang";
import { SceneProps, relLines, useTL } from "../timeline";
import { C, F } from "../theme";
import { clamp, drift, ease, keys, prog, rand } from "../lib/anim";
import { Backdrop, Dust } from "../components/Backdrop";
import { Flash, Letterbox, LightLeak } from "../components/Film";
import { Counter, Stamp, Words } from "../components/Type";
import { Icon, IconName } from "../components/Icons";
import { CamRig, Phone, QR_TEXT, RupeeField, Stage, drawPayScreen, qrMatrix, useCanvasTexture } from "../three/kit";

/* A sea of QR tiles pulsing as they get scanned: "800 million times a day". */
const N_SEA = 46;
const QRSeaMesh: React.FC = () => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const tex = useCanvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#f2efe8";
    ctx.fillRect(0, 0, 256, 256);
    const n = cells.length;
    const m = 224 / n;
    ctx.fillStyle = "#0b0d12";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y][x]) ctx.fillRect(16 + x * m, 16 + y * m, m + 0.5, m + 0.5);
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(() => new Float32Array(N_SEA * N_SEA * 3), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    let i = 0;
    for (let y = 0; y < N_SEA; y++)
      for (let x = 0; x < N_SEA; x++) {
        const r = rand(x * 91 + y * 7);
        const pulse = Math.max(0, Math.sin(frame * 0.18 + r * 40)) ** 18;
        o.position.set((x - N_SEA / 2) * 1.25, (y - N_SEA / 2) * 1.25, pulse * 0.35);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        const b = 0.18 + pulse * 2.2;
        col.setRGB(b * (pulse > 0.2 ? 0.55 : 1), b, b * (pulse > 0.2 ? 0.95 : 1));
        col.toArray(colors, i * 3);
        i++;
      }
    mesh.instanceMatrix.needsUpdate = true;
    if (!mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    else mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N_SEA * N_SEA]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </instancedMesh>
  );
};

const QRSea: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  // camera: starts on one tile, pulls way back while tilting up
  const z = keys(frame, [[0, 2.2], [len, 40]], ease.cam);
  const tilt = interpolate(frame / Math.max(1, len), [0, 1], [0, 0.55], clamp);
  return (
    <Stage bloom={1.1} fog={["#04060b", 10, 70]} env={false}>
      <CamRig pos={[0.6 + drift(frame, 2, 0.3), -z * Math.sin(tilt) + 0.6, z * Math.cos(tilt)]} target={[0.6, 0.6, 0]} fov={40} />
      <ambientLight intensity={1} />
      <QRSeaMesh />
    </Stage>
  );
};

/* Three everyday payments, one per beat. */
const Vignette: React.FC<{ icon: IconName; label: string; amount: string; start: number; end: number }> = ({ icon, label, amount, start, end }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  if (frame < start - 2 || frame > end + 2) return null;
  const p = prog(frame, start, 8, ease.out);
  const zoom = interpolate(frame, [start, end], [1.08, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${zoom})`, opacity: p }}>
      <Backdrop hue="amber" light={0.9} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} start={start} size={300} dur={14} stagger={3} />
        <div style={{ fontFamily: F.hiDisplay, fontSize: 120, color: C.ink, marginTop: 10, letterSpacing: "0.04em", lineHeight: 1 }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontSize: 40, color: C.amber, letterSpacing: "0.2em", marginTop: 8 }}>{amount}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* The scan: phone sweeps in, scan beam, 2-second timer, paid. */
const ScanShot: React.FC<{ len: number; paidAt: number }> = ({ len, paidAt }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const scan = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "scan"), []);
  const done = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "done"), []);
  const ry = keys(frame, [[0, -0.9], [len * 0.5, -0.18], [len, 0.12]]);
  const camZ = keys(frame, [[0, 10.5], [len, 8.6]]);
  return (
    <AbsoluteFill>
      <Backdrop hue="teal" />
      <Stage bloom={0.8}>
        <CamRig pos={[drift(frame, 4, 0.15), 0.3, camZ]} target={[0, 0, 0]} />
        <ambientLight intensity={0.2} />
        <spotLight position={[4, 6, 6]} angle={0.5} penumbra={0.8} intensity={120} color="#ffd2a0" />
        <pointLight position={[-4, -2, 3]} intensity={40} color={C.teal} />
        <Phone screen={frame >= paidAt ? done : scan} rotation={[0.08, ry, 0.04]} glow={1.15} scan={frame < paidAt ? (frame % 24) / 24 : undefined} />
      </Stage>
      <div style={{ position: "absolute", right: 170, top: 420, textAlign: "right" }}>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.inkDim, letterSpacing: "0.3em" }}>TIME</div>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 170, color: frame >= paidAt ? C.green : C.ink, lineHeight: 1 }}>
          {interpolate(frame, [0, paidAt], [0, 2], clamp).toFixed(1)}s
        </div>
      </div>
      <Flash at={paidAt} color="61,220,132" peak={0.35} len={10} />
    </AbsoluteFill>
  );
};

/* "FREE" — then it cracks. */
const FreeWord: React.FC<{ start: number; crackAt: number }> = ({ start, crackAt }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const cracked = frame >= crackAt;
  const g = cracked ? Math.max(0, 1 - (frame - crackAt) / 18) : 0;
  const jitter = cracked && frame - crackAt < 14 ? (rand(frame) - 0.5) * 40 : 0;
  const p = prog(frame, start, 10, ease.out);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", transform: `scale(${interpolate(p, [0, 1], [1.4, 1])})`, opacity: p }}>
        {[C.red, C.teal, C.ink].map((col, i) => (
          <div
            key={i}
            style={{
              position: i < 2 ? "absolute" : "relative",
              inset: 0,
              fontFamily: F.wide,
              fontWeight: 800,
              fontSize: 300,
              letterSpacing: "0.12em",
              color: i === 2 ? (cracked ? C.red : C.teal) : col,
              opacity: i < 2 ? g * 0.8 : 1,
              transform: i < 2 ? `translateX(${(i === 0 ? -1 : 1) * (jitter + g * 18)}px)` : `translateX(${jitter * 0.3}px)`,
              mixBlendMode: i < 2 ? "screen" : undefined,
              textShadow: i === 2 ? `0 0 80px ${cracked ? C.red : C.teal}66` : undefined,
              clipPath: cracked && i === 2 ? `polygon(0 0, 100% 0, 100% ${48 + jitter * 0.2}%, 0 ${52 - jitter * 0.2}%, 0 100%, 100% 100%, 100% ${54}%, 0 ${50}%)` : undefined,
            }}
          >
            FREE
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* An endless bill unrolling out of the dark. Rows are abstract (no fake document). */
const EndlessBill: React.FC<{ start: number; len: number }> = ({ start, len }) => {
  const frame = useCurrentFrame() - start;
  const t = useT();
  const y = interpolate(frame, [0, len], [700, -900], { ...clamp, easing: ease.soft });
  return (
    <AbsoluteFill style={{ perspective: 1200 }}>
      <div
        style={{
          position: "absolute",
          right: 220,
          top: y,
          width: 560,
          transform: "rotateX(28deg)",
          transformOrigin: "50% 0%",
          background: "linear-gradient(#efe7d6, #e2d8c3)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.8), 0 0 80px rgba(255,165,58,0.15)",
          padding: "40px 46px",
          fontFamily: F.mono,
          color: C.paperInk,
        }}
      >
        <div style={{ fontFamily: F.hiDisplay, fontSize: 74, textAlign: "center", letterSpacing: "0.1em" }}>{t("BILL · बिल", "THE BILL")}</div>
        <div style={{ fontSize: 20, textAlign: "center", letterSpacing: "0.3em", opacity: 0.6, marginBottom: 18 }}>PAYABLE BY: ?</div>
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 24, padding: "7px 0", borderBottom: "1px dashed rgba(0,0,0,0.2)" }}>
            <span style={{ width: 200 + rand(i) * 120, height: 14, marginTop: 6, background: "rgba(29,26,22,0.22)", borderRadius: 3 }} />
            <span>₹ {(Math.floor(rand(i * 3) * 9000) + 100).toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
      <AbsoluteFill style={{ background: "linear-gradient(#04060b 0%, rgba(4,6,11,0) 25%, rgba(4,6,11,0) 70%, #04060b 100%)" }} />
    </AbsoluteFill>
  );
};

export const S00_ColdOpen: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const t = useT();
  const lang = useLang();
  const L = relLines(seg);
  const a = L.c0_01, b = L.c0_02, c = L.c0_03, d = L.c0_04, e = L.c0_05, f = L.c0_06, g = L.c0_07;
  const third = (b.end - b.at) / 3;
  // ticking second hand in the black
  const tick = Math.floor(frame / 15);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* pre-roll: a single ticking hand */}
      <Sequence durationInFrames={a.at + 4} layout="none">
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <svg width={220} height={220} viewBox="-110 -110 220 220" style={{ opacity: prog(frame, 0, 10) }}>
            <circle r={100} fill="none" stroke="rgba(242,239,232,0.25)" strokeWidth={2} />
            {Array.from({ length: 60 }).map((_, i) => (
              <line key={i} x1={0} y1={-100} x2={0} y2={i % 5 === 0 ? -88 : -94} stroke="rgba(242,239,232,0.4)" strokeWidth={i % 5 === 0 ? 3 : 1} transform={`rotate(${i * 6})`} />
            ))}
            <line x1={0} y1={12} x2={0} y2={-90} stroke={C.amber} strokeWidth={3} transform={`rotate(${tick * 6})`} />
            <circle r={5} fill={C.amber} />
          </svg>
        </AbsoluteFill>
      </Sequence>

      {/* A — the sea of QR codes */}
      <Sequence from={a.at - 6} durationInFrames={b.at - a.at + 10} layout="none">
        <QRSea len={b.at - a.at + 10} />
        <AbsoluteFill style={{ background: "linear-gradient(rgba(4,6,11,0) 45%, rgba(4,6,11,0.92) 85%)" }} />
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 150 }}>
          <Words text={t("हर दिन... *80 करोड़* बार।", "Every day... *800 million* times.")} start={6} size={92} font={F.hiDisplay} weight={500} stagger={5} />
        </AbsoluteFill>
      </Sequence>

      {/* B — chai, petrol, rent */}
      <Sequence from={b.at} durationInFrames={c.at - b.at} layout="none">
        <Vignette icon="chai" label={t("चाय", "TEA")} amount="₹ 20" start={0} end={third} />
        <Vignette icon="fuel" label={t("पेट्रोल", "PETROL")} amount="₹ 2,500" start={third} end={third * 2} />
        <Vignette icon="rent" label={t("किराया", "RENT")} amount="₹ 15,000" start={third * 2} end={c.at - b.at} />
      </Sequence>

      {/* C — one scan, two seconds */}
      <Sequence from={c.at} durationInFrames={d.at - c.at} layout="none">
        <ScanShot len={d.at - c.at} paidAt={Math.round((c.end - c.at) * c.fr(0.72))} />
      </Sequence>

      {/* D/E — FREE ... cracks */}
      <Sequence from={d.at} durationInFrames={f.at - d.at} layout="none">
        <Backdrop hue={frame >= e.at ? "red" : "teal"} light={0.8} />
        <FreeWord start={0} crackAt={e.at - d.at} />
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 170 }}>
          {frame < e.at ? (
            <div style={{ display: "flex", gap: 60 }}>
              <Stamp text="FEE ₹0" at={8} color={C.teal} rotate={-6} size={90} />
              <Stamp text="CHARGE ₹0" at={Math.round((d.end - d.at) * d.fr(0.45))} color={C.teal} rotate={5} size={90} />
            </div>
          ) : (
            <Words text={t("दुनिया का सबसे बड़ा real-time payment system...|*फ़्री में नहीं चलता।*", "The world's largest real-time payment system...|*does not run for free.*")} start={e.at - d.at + 4} size={64} accent={C.red} stagger={3} />
          )}
        </AbsoluteFill>
      </Sequence>

      {/* F — the endless bill */}
      <Sequence from={f.at} durationInFrames={g.at - f.at} layout="none">
        <Backdrop hue="amber" light={0.7} />
        <EndlessBill start={0} len={g.at - f.at} />
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 160 }}>
          <Words text={t("कोई तो है...|जो *हर दिन*|इसका बिल|भर रहा है।", "Someone...|is paying|its bill|*every day.*")} start={4} size={96} font={F.hiDisplay} weight={500} align="left" lineHeight={1.0} stagger={4} />
        </AbsoluteFill>
      </Sequence>

      {/* G — WHO? */}
      <Sequence from={g.at} layout="none">
        <AbsoluteFill style={{ background: "#020305", alignItems: "center", justifyContent: "center" }}>
          <Words text={t("सवाल ये है —", "The question is —")} start={0} size={56} color={C.inkDim} weight={500} style={{ marginBottom: 60 }} />
          <div
            style={{
              fontFamily: F.hiDisplay,
              fontSize: 380,
              lineHeight: 0.9,
              color: C.ink,
              opacity: prog(frame - g.at, Math.round((g.end - g.at) * g.fr(0.45)), 4, ease.out),
              transform: `scale(${interpolate(prog(frame - g.at, Math.round((g.end - g.at) * g.fr(0.45)), 8, ease.out), [0, 1], [1.5, 1])})`,
              textShadow: "0 0 90px rgba(255,165,58,0.35)",
            }}
          >
            {t("कौन?", "WHO?")}
          </div>
        </AbsoluteFill>
      </Sequence>
      <Dust count={40} />
    </AbsoluteFill>
  );
};

/* TITLE — 3D rupee storm + slammed title. */
export const S01_Title: React.FC<SceneProps> = ({ seg }) => {
  const frame = useCurrentFrame();
  const TL = useTL();
  const t = useT();
  const lang = useLang();
  const p = prog(frame, 0, 10, ease.out);
  const push = interpolate(frame, [0, seg.frames], [1.0, 1.08], clamp);
  const track = interpolate(frame, [0, seg.frames], [0.5, 0.34], { ...clamp, easing: ease.soft });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Backdrop hue="amber" light={1.2} />
      <Stage bloom={1.2} env={false}>
        <CamRig pos={[0, 0, keys(frame, [[0, 14], [seg.frames, 9]])]} />
        <RupeeField count={260} opacity={0.55} speed={2.4} />
      </Stage>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${push})` }}>
        <div
          style={{
            fontFamily: F.hiDisplay,
            fontSize: 196,
            lineHeight: 0.95,
            color: C.ink,
            textAlign: "center",
            opacity: p,
            transform: `scale(${interpolate(p, [0, 1], [1.35, 1])})`,
            filter: `blur(${(1 - p) * 20}px)`,
            textShadow: "0 0 70px rgba(255,165,58,0.35), 0 10px 40px rgba(0,0,0,0.8)",
          }}
        >
          {lang === "en" ? (
            <>
              WHO REALLY PAYS
              <br />
              FOR <span style={{ color: C.amber }}>FREE</span> UPI?
            </>
          ) : (
            <>
              <span style={{ color: C.amber }}>FREE</span> UPI का बिल
              <br />
              कौन भरता है?
            </>
          )}
        </div>
        <div
          style={{
            fontFamily: F.wide,
            fontWeight: 300,
            fontSize: 30,
            letterSpacing: `${track}em`,
            paddingLeft: `${track}em`,
            color: C.inkDim,
            marginTop: 40,
            opacity: prog(frame, 14, 16),
          }}
        >
          {t(TL.title_en, "THE HIDDEN COST OF INDIA'S DIGITAL PAYMENTS")}
        </div>
      </AbsoluteFill>
      <LightLeak start={0} dur={seg.frames} strength={0.5} />
      <Letterbox amount={1} />
    </AbsoluteFill>
  );
};
