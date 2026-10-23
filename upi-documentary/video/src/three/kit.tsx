import React, { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import QRCode from "qrcode";
import { C } from "../theme";

/* ------------------------------------------------------------------ stage */

export const Stage: React.FC<{
  children: React.ReactNode;
  fov?: number;
  /** kept for call-site compatibility; glow is done with <Halo> sprites */
  bloom?: number;
  fog?: [string, number, number];
  env?: boolean;
}> = ({ children, fov = 35, fog, env = true }) => {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{ fov, near: 0.1, far: 400, position: [0, 0, 10] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      style={{ position: "absolute", inset: 0 }}
    >
      {fog && <fog attach="fog" args={fog} />}
      {env && <StudioEnv />}
      {children}
    </ThreeCanvas>
  );
};

/** Procedural studio reflections (no HDR download): softboxes for metal and glass. */
const StudioEnv: React.FC = () => (
  <Environment resolution={256} frames={1}>
    <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 5, -6]} scale={[10, 2, 1]} />
    <Lightformer form="rect" intensity={2.2} color="#ffb868" position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
    <Lightformer form="rect" intensity={1.6} color="#7ff5ea" position={[6, 0, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
    <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[0, 0, 8]} scale={3} />
  </Environment>
);

/** Frame-driven camera: position + look-at target + optional fov. */
export const CamRig: React.FC<{ pos: [number, number, number]; target?: [number, number, number]; fov?: number; roll?: number }> = ({
  pos,
  target = [0, 0, 0],
  fov,
  roll = 0,
}) => {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(...pos);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(...target);
    if (fov && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  });
  return null;
};

/* ------------------------------------------------------------- textures */

export const useCanvasTexture = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) =>
  useMemo(() => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    draw(ctx);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

export const qrMatrix = (text: string) => {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size;
  const cells: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) row.push(Boolean(q.modules.get(x, y)));
    cells.push(row);
  }
  return cells;
};

// The QR in the film is scannable — it carries the film's question, not a payment address.
export const QR_TEXT = "Who really pays for your 'free' UPI?";

/* ---------------------------------------------------------------- phone */

export const Phone: React.FC<{
  screen: THREE.Texture;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  glow?: number;
  /** 0..1 scan beam position over the on-screen QR; undefined = no beam */
  scan?: number;
}> = ({ screen, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, glow = 1, scan }) => (
  <group position={position} rotation={rotation} scale={scale}>
    <RoundedBox args={[2.1, 4.3, 0.22]} radius={0.24} smoothness={8}>
      <meshPhysicalMaterial color="#14161c" metalness={0.85} roughness={0.28} clearcoat={1} clearcoatRoughness={0.15} />
    </RoundedBox>
    <mesh position={[0, 0, 0.112]}>
      <planeGeometry args={[1.94, 4.12]} />
      <meshBasicMaterial map={screen} toneMapped={false} color={new THREE.Color(glow, glow, glow)} />
    </mesh>
    {scan !== undefined && (
      <group position={[0, 1.236 - scan * 1.436, 0.118]}>
        <mesh>
          <planeGeometry args={[1.62, 0.025]} />
          <meshBasicMaterial color={C.teal} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.09, -0.001]}>
          <planeGeometry args={[1.62, 0.18]} />
          <meshBasicMaterial color={C.teal} transparent opacity={0.18} toneMapped={false} />
        </mesh>
      </group>
    )}
    {/* camera island */}
    <mesh position={[0.52, 1.62, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.2, 0.2, 0.05, 32]} />
      <meshStandardMaterial color="#0a0a0c" metalness={0.9} roughness={0.2} />
    </mesh>
  </group>
);

/** Draws a clean, brand-neutral payment screen with a QR. */
export const drawPayScreen = (ctx: CanvasRenderingContext2D, cells: boolean[][], amount = "₹ 2,500", status: "scan" | "done" = "scan") => {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d1220");
  g.addColorStop(1, "#05070c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "500 34px 'IBM Plex Mono'";
  ctx.fillText("9:41", 48, 70);
  ctx.textAlign = "center";
  ctx.font = "600 52px 'Mukta'";
  ctx.fillStyle = "#f2efe8";
  ctx.fillText(status === "scan" ? "Scan & Pay" : "Payment successful", W / 2, 230);
  // QR card
  const s = W * 0.74;
  const x0 = (W - s) / 2;
  const y0 = 330;
  ctx.fillStyle = "#f6f3ec";
  roundRect(ctx, x0 - 24, y0 - 24, s + 48, s + 48, 36);
  ctx.fill();
  const n = cells.length;
  const m = s / n;
  ctx.fillStyle = "#0b0d12";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y][x]) ctx.fillRect(x0 + x * m, y0 + y * m, m + 0.6, m + 0.6);
  ctx.font = "700 110px 'Teko'";
  ctx.fillStyle = status === "done" ? "#3ddc84" : "#f2efe8";
  ctx.fillText(amount, W / 2, y0 + s + 190);
  ctx.font = "500 36px 'IBM Plex Mono'";
  ctx.fillStyle = "rgba(242,239,232,0.6)";
  ctx.fillText(status === "done" ? "✓  FEE  ₹0.00" : "UPI  ·  INSTANT", W / 2, y0 + s + 260);
};

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/* ------------------------------------------------------------ 3D QR field */

/**
 * QR modules as extruded blocks. rise 0..1 lifts them out of the plane;
 * scatter 0..1 blows them apart into floating debris (the "vanishing" act).
 */
export const QRBlocks: React.FC<{ cells: boolean[][]; rise: number; scatter?: number; size?: number; color?: string; emissive?: number }> = ({
  cells,
  rise,
  scatter = 0,
  size = 4,
  color = C.ink,
  emissive = 0.15,
}) => {
  const n = cells.length;
  const m = size / n;
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const arr: { x: number; y: number; r: number }[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y][x]) arr.push({ x, y, r: Math.sin((x * 31 + y * 17) * 12.9898) * 43758.5453 % 1 });
    return arr;
  }, [cells, n]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      const r = Math.abs(it.r);
      const px = (it.x - n / 2 + 0.5) * m;
      const py = (n / 2 - it.y - 0.5) * m;
      const delay = r * 0.5;
      const lift = Math.max(0, Math.min(1, (rise - delay * 0.6) / 0.5));
      const h = m * (0.25 + 1.4 * lift * (0.4 + r * 0.6));
      const sc = scatter * (0.6 + r);
      o.position.set(px * (1 + sc * 1.8) + Math.sin(i) * sc * 2, py * (1 + sc * 1.8) + Math.cos(i * 1.3) * sc * 2, h / 2 + sc * (2 + r * 6));
      o.rotation.set(sc * r * 6, sc * (1 - r) * 5, sc * r * 3);
      o.scale.set(m * 0.92 * (1 - scatter * 0.5), m * 0.92 * (1 - scatter * 0.5), h);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.35} emissive={color} emissiveIntensity={emissive} />
    </instancedMesh>
  );
};

/* ---------------------------------------------------------------- coin */

export const Coin: React.FC<{ angle: number; tilt?: number; position?: [number, number, number]; scale?: number }> = ({
  angle,
  tilt = 0.25,
  position = [0, 0, 0],
  scale = 1,
}) => {
  const face = useCanvasTexture(1024, 1024, (ctx) => drawCoinFace(ctx, "₹", "1"), []);
  const back = useCanvasTexture(1024, 1024, (ctx) => drawCoinFace(ctx, "?", ""), []);
  const bump = useCanvasTexture(1024, 1024, (ctx) => drawCoinFace(ctx, "₹", "1", true), []);
  const bumpBack = useCanvasTexture(1024, 1024, (ctx) => drawCoinFace(ctx, "?", "", true), []);
  const edge = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 1, roughness: 0.32 }), []);
  const mFront = useMemo(() => new THREE.MeshStandardMaterial({ map: face, bumpMap: bump, bumpScale: 6, metalness: 1, roughness: 0.28 }), [face, bump]);
  const mBack = useMemo(() => new THREE.MeshStandardMaterial({ map: back, bumpMap: bumpBack, bumpScale: 6, metalness: 1, roughness: 0.28 }), [back, bumpBack]);
  return (
    <group position={position} scale={scale} rotation={[tilt, 0, 0]}>
      <group rotation={[0, angle, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={[edge, mFront, mBack]}>
          <cylinderGeometry args={[1, 1, 0.14, 128, 1]} />
        </mesh>
      </group>
    </group>
  );
};

const drawCoinFace = (ctx: CanvasRenderingContext2D, glyph: string, value: string, heightMap = false) => {
  const S = ctx.canvas.width;
  ctx.fillStyle = heightMap ? "#202020" : "#cfd2d8";
  ctx.fillRect(0, 0, S, S);
  if (!heightMap) {
    const g = ctx.createRadialGradient(S * 0.4, S * 0.35, 10, S / 2, S / 2, S * 0.6);
    g.addColorStop(0, "#f4f5f7");
    g.addColorStop(1, "#9aa0a8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.strokeStyle = heightMap ? "#ffffff" : "#eef0f3";
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * S * 0.46, S / 2 + Math.sin(a) * S * 0.46);
    ctx.lineTo(S / 2 + Math.cos(a) * S * 0.49, S / 2 + Math.sin(a) * S * 0.49);
    ctx.stroke();
  }
  ctx.fillStyle = heightMap ? "#ffffff" : "#e9ebef";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${value ? 420 : 520}px 'Mukta'`;
  ctx.fillText(glyph, S / 2, S * (value ? 0.42 : 0.5));
  if (value) {
    ctx.font = "600 260px 'Teko'";
    ctx.fillText(value, S / 2, S * 0.78);
  }
  // cylinder caps are mapped with the texture's v flipped relative to canvas; mirror for the front face
};

/* ------------------------------------------------------------ particles */

/** Drifting ₹ glyph sprites. */
export const RupeeField: React.FC<{ count?: number; spread?: [number, number, number]; opacity?: number; speed?: number; color?: string }> = ({
  count = 220,
  spread = [26, 14, 20],
  opacity = 0.8,
  speed = 1,
  color = C.amber,
}) => {
  const frame = useCurrentFrame();
  const tex = useCanvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 104px 'Mukta'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("₹", 64, 70);
  }, []);
  const base = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (k: number) => {
          const x = Math.sin((i + 1) * 12.9898 * k + 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return [(r(1) - 0.5) * spread[0], (r(2) - 0.5) * spread[1], (r(3) - 0.5) * spread[2] - 4, r(4)];
      }),
    [count, spread],
  );
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);
  useLayoutEffect(() => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    base.forEach(([x, y, z, r], i) => {
      p.setXYZ(i, x + Math.sin(frame * 0.01 + i) * 0.3, ((y + frame * 0.012 * speed * (0.4 + r) + spread[1] / 2) % spread[1]) - spread[1] / 2, z);
    });
    p.needsUpdate = true;
  });
  return (
    <points geometry={geo}>
      <pointsMaterial map={tex} size={0.45} sizeAttenuation transparent opacity={opacity} depthWrite={false} color={color} blending={THREE.AdditiveBlending} />
    </points>
  );
};

/** Additive glow sprite (cheap bloom substitute that works on the CPU renderer). */
export const Halo: React.FC<{ position?: [number, number, number]; size?: number; color?: string; opacity?: number }> = ({
  position = [0, 0, 0],
  size = 3,
  color = "#ffffff",
  opacity = 0.8,
}) => {
  const tex = useCanvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.55)");
    g.addColorStop(0.45, "rgba(255,255,255,0.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }, []);
  return (
    <sprite position={position} scale={[size, size, 1]}>
      <spriteMaterial map={tex} color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  );
};

/** Glowing node used in the payment-machine diagram. */
export const GlowNode: React.FC<{ position: [number, number, number]; color?: string; on?: number; size?: number }> = ({
  position,
  color = C.teal,
  on = 1,
  size = 0.5,
}) => (
  <group position={position}>
    <mesh>
      <icosahedronGeometry args={[size, 4]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4 + on * 2.6} metalness={0.2} roughness={0.3} />
    </mesh>
    <mesh>
      <torusGeometry args={[size * 1.6, size * 0.04, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.25 + on * 0.6} toneMapped={false} />
    </mesh>
    <Halo size={size * 7} color={color} opacity={0.15 + on * 0.6} />
  </group>
);
