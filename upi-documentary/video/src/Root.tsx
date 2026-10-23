import { Composition } from "remotion";
import { Main, SegmentPreview } from "./Main";
import { TLS } from "./timeline";
import { FPS, H, W } from "./theme";
import "./fonts";
import { Thumbnail } from "./Thumbnail";
import { GridBake } from "./test/GridBake";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Thumbnail" component={Thumbnail} defaultProps={{ lang: "hi" as const }} durationInFrames={1} fps={30} width={1280} height={720} />
    <Composition id="Thumbnail-EN" component={Thumbnail} defaultProps={{ lang: "en" as const }} durationInFrames={1} fps={30} width={1280} height={720} />
    <Composition id="GridBake" component={GridBake} defaultProps={{ hue: "teal" }} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id="Main" component={Main} defaultProps={{ lang: "hi" as const }} durationInFrames={TLS.hi.frames} fps={FPS} width={W} height={H} />
    <Composition id="Main-EN" component={Main} defaultProps={{ lang: "en" as const }} durationInFrames={TLS.en.frames} fps={FPS} width={W} height={H} />
    {(["hi", "en"] as const).flatMap((lang) =>
      TLS[lang].segments.map((s) => (
        <Composition
          key={`${lang}-${s.id}`}
          id={`${lang === "en" ? "en-" : ""}seg-${s.id.replace(/_/g, "-")}`}
          component={SegmentPreview}
          defaultProps={{ id: s.id, lang }}
          durationInFrames={Math.max(1, s.frames)}
          fps={FPS}
          width={W}
          height={H}
        />
      )),
    )}
  </>
);
