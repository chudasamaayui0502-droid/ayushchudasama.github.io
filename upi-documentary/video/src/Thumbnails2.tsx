import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { C, F } from "./theme";
import { CamRig, Coin, GlowPoints, Halo, Phone, QR_TEXT, Stage, drawPayScreen, qrMatrix, useCanvasTexture } from "./three/kit";
import { rand } from "./lib/anim";
import { loadFonts } from "./fonts";
import type { Lang } from "./lang";

loadFonts();

/*
 * Two alternative YouTube thumbnails (1280×720; render with --scale=1.5 for a crisp 1920×1080 upload).
 *   ThumbNever   — dark, cinematic, one hero object + 3 huge words (documentary "downfall" look)
 *   ThumbWhoPays — bright versus layout: ₹0 for you vs ~₹20,000 cr a year, big yellow question, red arrow
 * Every claim on them is sourced (₹0 fee to users; ~₹20,000 cr a year to run UPI per the Ministry of Finance
 * MDR FAQs of 15 Sep 2026, Q10 — research/facts.md 5.9; 0.4% MDR above ₹2,000).
 */

/* ------------------------------------------------------------------ shared bits */

const crackScreen = (ctx: CanvasRenderingContext2D, cells: boolean[][]) => {
  drawPayScreen(ctx, cells, "₹ 2,500", "done");
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cx = W * 0.6;
  const cy = H * 0.36;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = "round";
  for (let i = 0; i < 22; i++) {
    let a = (i / 22) * Math.PI * 2 + rand(i) * 0.3;
    let x = cx;
    let y = cy;
    const len = 0.35 + rand(i * 3) * 0.75;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) {
      a += (rand(i * 17 + s) - 0.5) * 0.5;
      const step = (H * len) / 9;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3.2 - (i % 3);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,90,70,0.35)";
    ctx.lineWidth = 9;
    ctx.stroke();
  }
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const rr = r * 55 * (0.85 + rand(r * 9 + k) * 0.3);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.5 - r * 0.09})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 120);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.3, "rgba(255,120,90,0.5)");
  g.addColorStop(1, "rgba(255,59,59,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - 130, cy - 130, 260, 260);
};

const Embers: React.FC<{ n: number; seed: number; box: [number, number, number, number, number, number]; colors: [number, number, number][] }> = ({ n, seed, box, colors }) => {
  const buf = useMemo(() => {
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = (k: number) => rand(seed + i * 7.3 + k);
      pos[i * 3] = box[0] + (box[1] - box[0]) * r(1);
      pos[i * 3 + 1] = box[2] + (box[3] - box[2]) * r(2);
      pos[i * 3 + 2] = box[4] + (box[5] - box[4]) * r(3);
      size[i] = 0.05 + r(4) * 0.22;
      alpha[i] = 0.35 + r(5) * 0.65;
      col.set(colors[Math.floor(r(6) * colors.length)], i * 3);
    }
    return { pos, size, alpha, col };
  }, [n, seed, box, colors]);
  return <GlowPoints positions={buf.pos} sizes={buf.size} alphas={buf.alpha} colors={buf.col} />;
};

const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.8 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,${strength}) 100%)` }} />
);

/* ======================================================= A: "UPI WAS NEVER FREE" */

const CrackedPhoneShot: React.FC = () => {
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const tex = useCanvasTexture(780, 1650, (ctx) => crackScreen(ctx, cells), []);
  return (
    <>
      <CamRig pos={[0, 0.1, 9.2]} target={[0.9, 0, 0]} fov={35} />
      <ambientLight intensity={0.12} />
      <spotLight position={[5, 4, 5]} angle={0.5} penumbra={0.9} intensity={140} color="#ffd2b0" />
      <pointLight position={[3.4, 0.5, -2.5]} intensity={160} color={C.red} />
      <pointLight position={[-1, -2, 3]} intensity={25} color="#ff8a60" />
      <Halo position={[3.0, 0.2, -2]} size={11} color={C.red} opacity={0.55} />
      <Halo position={[2.95, 0.75, 0.3]} size={2.6} color="#ffd0c0" opacity={0.5} />
      <Phone screen={tex} position={[2.6, -0.05, 0]} rotation={[0.12, -0.42, 0.14]} scale={1.28} glow={1.05} />
      <pointLight position={[1.4, -1.2, 3.4]} intensity={45} color="#ffe6c8" />
      <pointLight position={[4.2, 2.6, 2.4]} intensity={30} color="#ffe6c8" />
      <Coin angle={0.7} tilt={0.55} position={[1.0, -2.0, 1.7]} scale={0.55} />
      <Coin angle={-0.5} tilt={-0.8} position={[4.35, 2.05, 0.8]} scale={0.4} />
      <Embers n={90} seed={11} box={[0.2, 6.5, -3.5, 3.5, -2, 2]} colors={[[1, 0.42, 0.25], [1, 0.72, 0.38], [1, 0.25, 0.22]]} />
    </>
  );
};

export const ThumbNever: React.FC<{ lang?: Lang }> = ({ lang = "hi" }) => {
  const big: React.CSSProperties = { fontFamily: F.hiDisplay, lineHeight: 0.84, color: C.ink, textShadow: "0 10px 50px rgba(0,0,0,0.95)" };
  return (
    <AbsoluteFill style={{ background: "#050304" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 55% 75% at 76% 50%, rgba(255,59,59,0.42) 0%, rgba(120,20,20,0.18) 45%, rgba(0,0,0,0) 75%)" }} />
      <Stage res={1} env>
        <CrackedPhoneShot />
      </Stage>
      <AbsoluteFill style={{ left: 64, right: 560, width: "auto", justifyContent: "center" }}>
        <div style={{ ...big, fontSize: lang === "en" ? 104 : 108 }}>{lang === "en" ? "UPI WAS NEVER" : "UPI कभी"}</div>
        <div style={{ alignSelf: "flex-start", ...big, position: "relative", display: "inline-block", fontSize: 300, color: "#ffffff", letterSpacing: "0.01em", marginTop: -6, textShadow: "0 0 60px rgba(255,59,59,0.45), 0 12px 50px rgba(0,0,0,0.95)" }}>
          FREE
          <div style={{ position: "absolute", left: -14, right: -14, top: "44%", height: 26, background: C.red, transform: "rotate(-8deg)", boxShadow: "0 0 30px rgba(255,59,59,0.85)", borderRadius: 4 }} />
        </div>
        {lang !== "en" && <div style={{ ...big, fontSize: 108, color: C.red }}>था ही नहीं</div>}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 66, top: 46, display: "flex", alignItems: "center", gap: 12, fontFamily: lang === "en" ? F.mono : F.hiBody, fontSize: lang === "en" ? 24 : 30, fontWeight: 600, letterSpacing: lang === "en" ? "0.3em" : "0.02em", color: "rgba(242,239,232,0.8)" }}>
        <span style={{ width: 34, height: 3, background: C.red }} />
        {lang === "en" ? "THE HIDDEN BILL" : "छुपा हुआ बिल"}
      </div>
      <Vignette strength={0.85} />
    </AbsoluteFill>
  );
};

/* ============================================ B: "₹0 for you — ~₹20,000 cr: WHO PAYS?" */

const VersusPhone: React.FC = () => {
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const tex = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "done"), []);
  return (
    <>
      <CamRig pos={[0, 0, 10]} target={[0, 0, 0]} fov={35} />
      <ambientLight intensity={0.3} />
      <spotLight position={[-3, 4, 6]} angle={0.6} penumbra={0.8} intensity={150} color="#ffffff" />
      <pointLight position={[-5, -1, 2]} intensity={60} color={C.green} />
      <Halo position={[-4.1, -0.5, -1.2]} size={7} color={C.green} opacity={0.4} />
      <Phone screen={tex} position={[-4.15, -0.85, 0]} rotation={[0.06, 0.4, -0.1]} scale={0.86} glow={1.2} />
    </>
  );
};

const BillPaper: React.FC<{ lang: Lang }> = ({ lang }) => (
  <div style={{ position: "absolute", right: 80, top: 196, width: 300, perspective: 900 }}>
    <div
      style={{
        transform: "rotateY(-18deg) rotateZ(5deg)",
        background: "linear-gradient(#f4ecda, #e3d6bc)",
        borderRadius: 6,
        padding: "22px 26px 18px",
        boxShadow: "0 30px 70px rgba(0,0,0,0.6), 0 0 60px rgba(255,59,59,0.35)",
        fontFamily: F.mono,
        color: C.paperInk,
      }}
    >
      <div style={{ fontFamily: F.hiDisplay, fontSize: 52, textAlign: "center", letterSpacing: "0.08em", lineHeight: 1 }}>{lang === "en" ? "THE BILL" : "बिल · BILL"}</div>
      <div style={{ fontSize: 15, textAlign: "center", letterSpacing: "0.25em", opacity: 0.6, marginBottom: 10 }}>UPI · PER YEAR</div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed rgba(0,0,0,0.25)" }}>
          <span style={{ width: 120 + rand(i) * 70, height: 10, marginTop: 5, background: "rgba(29,26,22,0.25)", borderRadius: 2 }} />
          <span style={{ width: 54, height: 10, marginTop: 5, background: "rgba(29,26,22,0.35)", borderRadius: 2 }} />
        </div>
      ))}
      <div style={{ marginTop: 10, fontSize: 18, letterSpacing: "0.15em", fontWeight: 600 }}>PAYABLE BY: ?</div>
    </div>
  </div>
);

export const ThumbWhoPays: React.FC<{ lang?: Lang }> = ({ lang = "hi" }) => {
  const outline = "-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 6px 0 #000, 0 14px 30px rgba(0,0,0,0.7)";
  return (
    <AbsoluteFill style={{ background: "#06080f" }}>
      {/* split: calm teal-green "free" world left, red "cost" world right, a hot diagonal seam */}
      <AbsoluteFill style={{ background: "linear-gradient(105deg, #0b3a33 0%, #082621 38%, #2a0707 52%, #5c0b0b 100%)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 40% 60% at 80% 62%, rgba(255,70,60,0.45) 0%, rgba(0,0,0,0) 70%), radial-gradient(ellipse 35% 60% at 18% 60%, rgba(61,220,132,0.32) 0%, rgba(0,0,0,0) 70%)" }} />
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0 }}>
        <polygon points="548,0 600,0 668,720 616,720" fill="rgba(255,255,255,0.08)" />
        <line x1={574} y1={0} x2={642} y2={720} stroke="#fff" strokeWidth={3} opacity={0.65} />
      </svg>
      <Stage res={1} env>
        <VersusPhone />
      </Stage>
      {/* left label */}
      <div style={{ position: "absolute", left: 300, top: 312, textAlign: "left" }}>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 150, lineHeight: 0.85, color: C.green, textShadow: outline }}>₹0</div>
        <div style={{ fontFamily: F.wide, fontWeight: 800, fontSize: 30, color: "#fff", letterSpacing: "0.06em", textShadow: outline, marginTop: 6 }}>{lang === "en" ? "YOU PAY" : "आप देते हैं"}</div>
      </div>
      <BillPaper lang={lang} />
      {/* right number */}
      <div style={{ position: "absolute", right: 44, top: 528, textAlign: "right" }}>
        <div style={{ fontFamily: F.hiDisplay, fontSize: 128, lineHeight: 0.85, color: "#ff4d4d", textShadow: outline, whiteSpace: "nowrap" }}>~₹20,000 CR</div>
        <div style={{ fontFamily: F.wide, fontWeight: 800, fontSize: 28, color: "#fff", letterSpacing: "0.06em", textShadow: outline, marginTop: 6 }}>{lang === "en" ? "COST TO RUN UPI / YEAR" : "UPI चलाने का सालाना ख़र्च"}</div>
      </div>
      {/* the big question */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 22, textAlign: "center" }}>
        <span
          style={{
            display: "inline-block",
            fontFamily: F.hiDisplay,
            fontSize: lang === "en" ? 168 : 150,
            lineHeight: 1,
            padding: "6px 34px 0",
            color: "#111",
            background: "#ffd400",
            transform: "rotate(-2deg)",
            borderRadius: 10,
            boxShadow: "0 12px 0 #000, 0 22px 50px rgba(0,0,0,0.6)",
          }}
        >
          {lang === "en" ? "WHO PAYS?" : "बिल कौन भरता है?"}
        </span>
      </div>
      {/* red arrow from "₹0" to the bill */}
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <marker id="ah" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#ff2d2d" stroke="#000" strokeWidth="0.4" />
          </marker>
        </defs>
        <path d="M 520 300 C 600 220, 720 220, 800 270" fill="none" stroke="#000" strokeWidth={22} strokeLinecap="round" />
        <path d="M 520 300 C 600 220, 720 220, 800 270" fill="none" stroke="#ff2d2d" strokeWidth={14} strokeLinecap="round" markerEnd="url(#ah)" />
      </svg>
      {/* sticker */}
      <div
        style={{
          position: "absolute",
          left: 330,
          bottom: 44,
          width: 150,
          height: 150,
          borderRadius: "50%",
          background: "#fff",
          border: "6px solid #000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: "rotate(-12deg)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontFamily: F.hiDisplay, fontSize: 64, lineHeight: 0.9, color: C.red }}>0.4%</div>
        <div style={{ fontFamily: F.wide, fontWeight: 800, fontSize: 19, color: "#111" }}>MDR</div>
        <div style={{ fontFamily: F.wide, fontWeight: 700, fontSize: 15, color: "#333" }}>₹2,000+</div>
      </div>
      <Vignette strength={0.55} />
    </AbsoluteFill>
  );
};
