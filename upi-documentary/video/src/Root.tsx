import { Composition } from "remotion";
import { Main, SegmentPreview } from "./Main";
import { TL } from "./timeline";
import { FPS, H, W } from "./theme";
import "./fonts";
import { Thumbnail } from "./Thumbnail";
import { GridBake } from "./test/GridBake";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={30} width={1280} height={720} />
    <Composition id="GridBake" component={GridBake} defaultProps={{ hue: "teal" }} durationInFrames={1} fps={30} width={1920} height={1080} />
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
