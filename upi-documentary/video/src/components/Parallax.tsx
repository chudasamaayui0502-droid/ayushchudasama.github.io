import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * After-Effects-style 2.5D camera. Layers live at a depth `z` (negative = further away)
 * and are scale-compensated so they still fill the frame; moving the camera then
 * produces true parallax between layers.
 */
export type Cam = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number };

const P = 1400; // perspective distance in px (≈ 35mm lens feel)

export const ParallaxWorld: React.FC<{ cam: Cam; children: React.ReactNode }> = ({ cam, children }) => {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = cam;
  return (
    <AbsoluteFill style={{ perspective: P, perspectiveOrigin: "50% 50%", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transformStyle: "preserve-3d",
          transform: `translateZ(${P}px) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${-x}px, ${-y}px, ${-P + z}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Layer: React.FC<{
  z?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotateY?: number;
  rotateX?: number;
  opacity?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ z = 0, x = 0, y = 0, scale = 1, rotateY = 0, rotateX = 0, opacity = 1, children, style }) => {
  const comp = (P - z) / P; // keep apparent size at rest
  return (
    <AbsoluteFill
      style={{
        transformStyle: "preserve-3d",
        transform: `translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${comp * scale})`,
        opacity,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
