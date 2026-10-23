import { AbsoluteFill } from "remotion";
import { PerspectiveGrid } from "../components/Backdrop";
const T: Record<string, string> = { teal: "40,210,200", amber: "255,140,40", red: "255,50,50", neutral: "180,190,210" };
export const GridBake: React.FC<{ hue: string }> = ({ hue }) => (
  <AbsoluteFill>
    <PerspectiveGrid tint={T[hue]} scroll={false} />
  </AbsoluteFill>
);
