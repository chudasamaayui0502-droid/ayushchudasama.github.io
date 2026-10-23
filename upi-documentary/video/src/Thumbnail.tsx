import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { C, F } from "./theme";
import { Backdrop } from "./components/Backdrop";
import { CamRig, Coin, Halo, Phone, QR_TEXT, Stage, drawPayScreen, qrMatrix, useCanvasTexture } from "./three/kit";
import { loadFonts } from "./fonts";
import type { Lang } from "./lang";

loadFonts();

const PhoneShot: React.FC = () => {
  const cells = useMemo(() => qrMatrix(QR_TEXT), []);
  const tex = useCanvasTexture(780, 1650, (ctx) => drawPayScreen(ctx, cells, "₹ 2,500", "scan"), []);
  return (
    <>
      <CamRig pos={[0.2, 0.2, 10.5]} target={[1.6, -0.2, 0]} />
      <ambientLight intensity={0.25} />
      <spotLight position={[3, 5, 6]} angle={0.6} penumbra={0.8} intensity={160} color="#ffd9b0" />
      <pointLight position={[-4, -1, 3]} intensity={40} color={C.teal} />
      <Halo position={[-2.4, 0, -1]} size={9} color={C.teal} opacity={0.35} />
      <Phone screen={tex} position={[-2.5, -0.1, 0]} rotation={[0.08, 0.42, -0.06]} glow={1.2} />
      <pointLight position={[0.5, -1, 4]} intensity={30} color="#ffe2c0" />
      <Coin angle={0.55} tilt={0.3} position={[-0.9, -1.75, 1.4]} scale={0.8} />
    </>
  );
};

/** 1280×720 thumbnail: phone + coin on the left, three-word headline on the right. */
export const Thumbnail: React.FC<{ lang?: Lang }> = ({ lang = "hi" }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Backdrop hue="amber" light={1.4} />
    <Stage res={1}>
      <PhoneShot />
    </Stage>
    <AbsoluteFill style={{ left: 600, right: 30, width: "auto", justifyContent: "center" }}>
      <div style={{ fontFamily: F.hiDisplay, lineHeight: 0.82, color: C.ink, textShadow: "0 8px 40px rgba(0,0,0,0.9)" }}>
        <div style={{ fontSize: 230, color: C.teal, letterSpacing: "0.02em", position: "relative", display: "inline-block" }}>
          FREE
          <span style={{ position: "absolute", right: -88, top: -26, fontSize: 240, color: C.red, transform: "rotate(12deg)", textShadow: "0 0 40px rgba(255,59,59,0.6)" }}>?</span>
        </div>
        {lang === "en" ? (
          <>
            <div style={{ fontSize: 138, marginTop: 10 }}>WHO PAYS</div>
            <div style={{ fontSize: 138, color: C.amber }}>FOR UPI?</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 138, marginTop: 10 }}>UPI का बिल</div>
            <div style={{ fontSize: 138, color: C.amber }}>कौन भरता है?</div>
          </>
        )}
      </div>
      <div style={{ marginTop: 26, display: "inline-flex", alignSelf: "flex-start", padding: "6px 22px", background: C.red, borderRadius: 8, fontFamily: F.wide, fontWeight: 800, fontSize: 40, color: "#fff", letterSpacing: "0.06em" }}>
        0.4% MDR · ₹2,000+
      </div>
    </AbsoluteFill>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 75% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.7) 100%)" }} />
  </AbsoluteFill>
);
