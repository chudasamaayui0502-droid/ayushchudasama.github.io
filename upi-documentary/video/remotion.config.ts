import { Config } from "@remotion/cli/config";

// Pre-installed Chromium headless shell (no download needed).
Config.setBrowserExecutable(
  process.env.REMOTION_CHROME ??
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
);
// CPU-only machine: WebGL through SwiftShader via ANGLE.
Config.setChromiumOpenGlRenderer("swangle");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setCrf(14);
Config.setPixelFormat("yuv420p");
Config.setConcurrency(4);
Config.setOverwriteOutput(true);
