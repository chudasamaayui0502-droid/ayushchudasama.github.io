import { Composition } from "remotion";
import { Main, SegmentPreview } from "./Main";
import { TL } from "./timeline";
import { FPS, H, W } from "./theme";
import "./fonts";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={TL.frames} fps={FPS} width={W} height={H} />
    {TL.segments.map((s) => (
      <Composition
        key={s.id}
        id={`seg-${s.id.replace(/_/g, "-")}`}
        component={SegmentPreview}
        defaultProps={{ id: s.id }}
        durationInFrames={Math.max(1, s.frames)}
        fps={FPS}
        width={W}
        height={H}
      />
    ))}
  </>
);
